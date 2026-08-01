import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { ExchangeProvider, ExchangeInterval } from "../../../exchange/domain/exchange.types";
import {
  MarketStreamState,
  MarketEventType,
  MarketIncidentCode,
} from "../../domain/market-data.enums";
import { MarketDataError } from "../../domain/market-data.errors";
import type {
  PublicMarketStreamAdapter,
} from "../../domain/public-market-stream.adapter";
import type {
  CandleSubscription,
  MarketStreamError,
  MarketStreamStatus,
  NormalizedCandle,
  NormalizedMarketEvent,
  NormalizedOrderBook,
  NormalizedTicker,
  NormalizedTrade,
  OrderBookSubscription,
  MarketEventMetadata,
  UnsubscribeFunction,
} from "../../domain/market-data.types";

/**
 * Map our unified interval enum values (e.g. "1m", "5m") to Binance kline
 * stream suffixes. Binance uses lowercase interval codes.
 */
function toBinanceInterval(interval: ExchangeInterval): string {
  return interval; // Binance uses the same codes: 1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,1w,1M
}

/**
 * Binance combined-stream symbols are lowercase, e.g. "btcusdt" for "BTC-USDT"
 */
function toBinanceStreamSymbol(symbol: string): string {
  return symbol.replace("-", "").toLowerCase();
}

/** Reverse: binance stream symbol to normalized symbol */
function fromBinanceStreamSymbol(raw: string): string {
  // heuristic: e.g. "btcusdt" → "BTC-USDT"
  // Binance perpetual futures always quote in USDT or USDC
  const upper = raw.toUpperCase();
  if (upper.endsWith("USDT")) {
    return `${upper.slice(0, -4)}-USDT`;
  }
  if (upper.endsWith("USDC")) {
    return `${upper.slice(0, -4)}-USDC`;
  }
  return upper;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toBooleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function toWebSocketMessage(data: WebSocket.Data): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return Buffer.concat(data).toString("utf8");
}

@Injectable()
export class BinancePublicStreamAdapter implements PublicMarketStreamAdapter {
  readonly provider = ExchangeProvider.BINANCE_FUTURES;
  private readonly logger = new Logger(BinancePublicStreamAdapter.name);

  private ws: WebSocket | null = null;
  private state = MarketStreamState.DISCONNECTED;
  private connectedAt?: Date;
  private lastMessageAt?: Date;
  private messageCount = 0;
  private malformedMessageCount = 0;
  private reconnectCount = 0;
  private lastReconnectAt?: Date;
  private lastErrorCode?: string;
  private lastErrorAt?: Date;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private currentReconnectDelay = 500;

  private readonly eventHandlers = new Set<
    (event: NormalizedMarketEvent) => void
  >();
  private readonly statusHandlers = new Set<
    (status: MarketStreamStatus) => void
  >();
  private readonly errorHandlers = new Set<
    (error: MarketStreamError) => void
  >();

  private readonly activeSubscriptions = new Map<string, string>();
  private pendingSubscriptions: string[] = [];

  private readonly baseUrl: string;
  private readonly staleAfterMs: number;
  private readonly maxReconnectDelay: number;
  private readonly baseReconnectDelay: number;
  private readonly maxReconnectAttempts: number;

  constructor(configService: ConfigService) {
    this.baseUrl =
      configService.get<string>("BINANCE_FUTURES_WS_URL") ??
      "wss://fstream.binance.com";
    this.staleAfterMs =
      (configService.get<number>("MARKET_STALE_AFTER_SECONDS") ?? 30) * 1000;
    this.maxReconnectDelay =
      configService.get<number>("MARKET_RECONNECT_MAX_DELAY_MS") ?? 30000;
    this.baseReconnectDelay =
      configService.get<number>("MARKET_RECONNECT_BASE_DELAY_MS") ?? 500;
    this.maxReconnectAttempts =
      configService.get<number>("MARKET_MAX_RECONNECT_ATTEMPTS") ?? 0;
    this.currentReconnectDelay = this.baseReconnectDelay;
  }

  async connect(): Promise<void> {
    if (
      this.state === MarketStreamState.CONNECTED ||
      this.state === MarketStreamState.CONNECTING
    ) {
      return;
    }
    this.setState(MarketStreamState.CONNECTING);

    const url = `${this.baseUrl}/stream`;
    this.ws = new WebSocket(url);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new MarketDataError(
            MarketIncidentCode.PROVIDER_UNAVAILABLE,
            this.provider,
            "Connection timeout",
          ),
        );
      }, 15000);

      this.ws!.on("open", () => {
        clearTimeout(timeout);
        this.connectedAt = new Date();
        this.currentReconnectDelay = this.baseReconnectDelay;
        this.setState(MarketStreamState.CONNECTED);
        this.startStaleDetection();

        // Replay pending subscriptions
        if (this.pendingSubscriptions.length > 0) {
          this.sendSubscribe(this.pendingSubscriptions);
          this.pendingSubscriptions = [];
        }

        this.emitEvent({
          type: MarketEventType.STREAM_CONNECTED,
          metadata: this.createMetadata("", "connection"),
          payload: { provider: this.provider },
        });

        resolve();
      });

      this.ws!.on("message", (data: WebSocket.Data) => {
        this.lastMessageAt = new Date();
        this.messageCount++;
        try {
          this.handleMessage(toWebSocketMessage(data));
        } catch {
          this.malformedMessageCount++;
        }
      });

      this.ws!.on("error", (error: Error) => {
        this.logger.error({
          event: "ws_error",
          message: error.message,
        });
        this.lastErrorCode = "WS_ERROR";
        this.lastErrorAt = new Date();
        this.emitError({
          provider: this.provider,
          code: "WS_ERROR",
          message: error.message,
          timestamp: new Date(),
          recoverable: true,
        });
      });

      this.ws!.on("close", (code: number, reason: Buffer) => {
        clearTimeout(timeout);
        this.stopStaleDetection();
        const reasonStr = Buffer.isBuffer(reason)
          ? reason.toString("utf8")
          : String(reason);
        this.logger.warn({
          event: "ws_close",
          code,
          reason: reasonStr,
        });

        this.emitEvent({
          type: MarketEventType.STREAM_DISCONNECTED,
          metadata: this.createMetadata("", "connection"),
          payload: {
            provider: this.provider,
            reason: `${code}: ${reasonStr}`,
          },
        });

        if (this.state !== MarketStreamState.DISCONNECTED) {
          this.scheduleReconnect();
        }
      });
    });
  }

  disconnect(): Promise<void> {
    this.setState(MarketStreamState.DISCONNECTED);
    this.stopStaleDetection();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close(1000, "Client disconnect");
      }
      this.ws = null;
    }
    this.activeSubscriptions.clear();
    return Promise.resolve();
  }

  subscribeTicker(symbols: string[]): Promise<void> {
    const streams = symbols.map(
      (s) => `${toBinanceStreamSymbol(s)}@ticker`,
    );
    this.subscribe(streams);
    return Promise.resolve();
  }

  subscribeCandles(subscriptions: CandleSubscription[]): Promise<void> {
    const streams = subscriptions.map(
      (sub) =>
        `${toBinanceStreamSymbol(sub.symbol)}@kline_${toBinanceInterval(sub.interval)}`,
    );
    this.subscribe(streams);
    return Promise.resolve();
  }

  subscribeTrades(symbols: string[]): Promise<void> {
    const streams = symbols.map(
      (s) => `${toBinanceStreamSymbol(s)}@aggTrade`,
    );
    this.subscribe(streams);
    return Promise.resolve();
  }

  subscribeOrderBook(
    subscriptions: OrderBookSubscription[],
  ): Promise<void> {
    const streams = subscriptions.map(
      (sub) =>
        `${toBinanceStreamSymbol(sub.symbol)}@depth${sub.depth}@100ms`,
    );
    this.subscribe(streams);
    return Promise.resolve();
  }

  unsubscribe(subscriptionIds: string[]): Promise<void> {
    const params = subscriptionIds.filter((id) =>
      this.activeSubscriptions.has(id),
    );
    if (params.length === 0) return Promise.resolve();

    for (const id of params) {
      this.activeSubscriptions.delete(id);
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          method: "UNSUBSCRIBE",
          params,
          id: Date.now(),
        }),
      );
    }
    return Promise.resolve();
  }

  getStatus(): MarketStreamStatus {
    return {
      provider: this.provider,
      state: this.state,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      activeSubscriptions: this.activeSubscriptions.size,
      reconnectCount: this.reconnectCount,
      lastReconnectAt: this.lastReconnectAt,
      lastErrorCode: this.lastErrorCode,
      lastErrorAt: this.lastErrorAt,
      messageCount: this.messageCount,
      malformedMessageCount: this.malformedMessageCount,
    };
  }

  onEvent(
    handler: (event: NormalizedMarketEvent) => void,
  ): UnsubscribeFunction {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  onStatusChange(
    handler: (status: MarketStreamStatus) => void,
  ): UnsubscribeFunction {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  onError(
    handler: (error: MarketStreamError) => void,
  ): UnsubscribeFunction {
    this.errorHandlers.add(handler);
    return () => {
      this.errorHandlers.delete(handler);
    };
  }

  // ─── Private ──────────────────────────────────────────────────
  private subscribe(streams: string[]): void {
    for (const s of streams) {
      this.activeSubscriptions.set(s, s);
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(streams);
    } else {
      this.pendingSubscriptions.push(...streams);
    }
  }

  private sendSubscribe(streams: string[]): void {
    this.ws?.send(
      JSON.stringify({
        method: "SUBSCRIBE",
        params: streams,
        id: Date.now(),
      }),
    );
  }

  private handleMessage(raw: string): void {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return;

    // Binance combined stream wraps in { stream, data }
    if ("result" in parsed && parsed.result !== undefined) return;
    const data = "data" in parsed ? parsed.data : parsed;
    const stream = toStringValue(parsed.stream) ?? "";

    if (stream.includes("@ticker")) {
      this.handleTickerMessage(data);
    } else if (stream.includes("@kline_")) {
      this.handleKlineMessage(data, stream);
    } else if (stream.includes("@aggTrade")) {
      this.handleTradeMessage(data);
    } else if (stream.includes("@depth")) {
      this.handleOrderBookMessage(data, stream);
    }
  }

  private handleTickerMessage(data: unknown): void {
    if (!isRecord(data)) return;
    const symbolValue = toStringValue(data.s);
    const timestamp = toNumberValue(data.E);
    if (!symbolValue || timestamp === undefined) return;

    const symbol = fromBinanceStreamSymbol(symbolValue);
    const ticker: NormalizedTicker = {
      provider: this.provider,
      symbol,
      lastPrice: toStringValue(data.c) ?? "",
      markPrice: undefined,
      bidPrice: toStringValue(data.b),
      askPrice: toStringValue(data.a),
      bidQuantity: toStringValue(data.B),
      askQuantity: toStringValue(data.A),
      high24h: toStringValue(data.h),
      low24h: toStringValue(data.l),
      volume24h: toStringValue(data.v),
      quoteVolume24h: toStringValue(data.q),
      priceChange24h: toStringValue(data.p),
      priceChangePercent24h: toStringValue(data.P),
      timestamp: new Date(timestamp),
    };

    this.emitEvent({
      type: MarketEventType.TICKER_UPDATED,
      metadata: this.createMetadata(symbol, `${symbol}@ticker`),
      payload: ticker,
    });
  }

  private handleKlineMessage(data: unknown, stream: string): void {
    if (!isRecord(data) || !isRecord(data.k)) return;
    const kline = data.k;
    const symbolValue = toStringValue(kline.s);
    const intervalValue = toStringValue(kline.i);
    const isClosed = toBooleanValue(kline.x);
    const openTime = toNumberValue(kline.t);
    const closeTime = toNumberValue(kline.T);
    if (
      !symbolValue ||
      !intervalValue ||
      isClosed === undefined ||
      openTime === undefined ||
      closeTime === undefined
    ) {
      return;
    }

    const symbol = fromBinanceStreamSymbol(symbolValue);
    const interval = intervalValue as ExchangeInterval;

    const candle: NormalizedCandle = {
      provider: this.provider,
      symbol,
      interval,
      openTime: new Date(openTime),
      closeTime: new Date(closeTime),
      open: toStringValue(kline.o) ?? "",
      high: toStringValue(kline.h) ?? "",
      low: toStringValue(kline.l) ?? "",
      close: toStringValue(kline.c) ?? "",
      volume: toStringValue(kline.v) ?? "",
      quoteVolume: toStringValue(kline.q),
      tradeCount: toNumberValue(kline.n),
      isClosed,
    };

    this.emitEvent({
      type: isClosed
        ? MarketEventType.CANDLE_CLOSED
        : MarketEventType.CANDLE_UPDATED,
      metadata: this.createMetadata(symbol, stream),
      payload: candle,
    });
  }

  private handleTradeMessage(data: unknown): void {
    if (!isRecord(data)) return;
    const symbolValue = toStringValue(data.s);
    const timestamp = toNumberValue(data.T);
    if (!symbolValue || timestamp === undefined) return;

    const symbol = fromBinanceStreamSymbol(symbolValue);
    const trade: NormalizedTrade = {
      provider: this.provider,
      symbol,
      tradeId: toStringValue(data.a) ?? "",
      price: toStringValue(data.p) ?? "",
      quantity: toStringValue(data.q) ?? "",
      side: toBooleanValue(data.m) ? "SELL" : "BUY",
      timestamp: new Date(timestamp),
    };

    this.emitEvent({
      type: MarketEventType.PUBLIC_TRADE_RECEIVED,
      metadata: this.createMetadata(symbol, `${symbol}@aggTrade`),
      payload: trade,
    });
  }

  private handleOrderBookMessage(data: unknown, stream: string): void {
    if (!isRecord(data)) return;
    const rawSymbol = stream.split("@")[0] ?? "";
    const symbol = fromBinanceStreamSymbol(rawSymbol);
    const bids = isUnknownArray(data.b)
      ? data.b
          .filter(isUnknownArray)
          .map((level) => {
            const price = toStringValue(level[0]);
            const quantity = toStringValue(level[1]);
            return price && quantity ? { price, quantity } : null;
          })
          .filter((level): level is { price: string; quantity: string } => level !== null)
      : [];
    const asks = isUnknownArray(data.a)
      ? data.a
          .filter(isUnknownArray)
          .map((level) => {
            const price = toStringValue(level[0]);
            const quantity = toStringValue(level[1]);
            return price && quantity ? { price, quantity } : null;
          })
          .filter((level): level is { price: string; quantity: string } => level !== null)
      : [];
    const timestamp = toNumberValue(data.E) ?? Date.now();

    const book: NormalizedOrderBook = {
      provider: this.provider,
      symbol,
      bids,
      asks,
      timestamp: new Date(timestamp),
      depth: Math.max(bids.length, asks.length),
    };

    this.emitEvent({
      type: MarketEventType.ORDER_BOOK_UPDATED,
      metadata: this.createMetadata(symbol, stream),
      payload: book,
    });
  }

  private scheduleReconnect(): void {
    if (
      this.maxReconnectAttempts > 0 &&
      this.reconnectCount >= this.maxReconnectAttempts
    ) {
      this.setState(MarketStreamState.FAILED);
      return;
    }

    this.setState(MarketStreamState.RECONNECTING);
    this.reconnectCount++;
    this.lastReconnectAt = new Date();

    const delay = Math.min(
      this.currentReconnectDelay * (1 + Math.random() * 0.1),
      this.maxReconnectDelay,
    );
    this.currentReconnectDelay = Math.min(
      this.currentReconnectDelay * 2,
      this.maxReconnectDelay,
    );

    this.logger.log({
      event: "ws_reconnect_scheduled",
      delayMs: Math.round(delay),
      attempt: this.reconnectCount,
    });

    this.reconnectTimer = setTimeout(() => {
      // Re-queue all active subscriptions as pending
      this.pendingSubscriptions = Array.from(this.activeSubscriptions.keys());
      void this.connect().catch((error) => {
        this.logger.error({
          event: "ws_reconnect_failed",
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, delay);
  }

  private startStaleDetection(): void {
    this.stopStaleDetection();
    this.staleTimer = setInterval(() => {
      if (!this.lastMessageAt) return;
      const age = Date.now() - this.lastMessageAt.getTime();
      if (
        age > this.staleAfterMs &&
        this.state === MarketStreamState.CONNECTED
      ) {
        this.setState(MarketStreamState.STALE);
        this.emitEvent({
          type: MarketEventType.STREAM_STALE,
          metadata: this.createMetadata("", "stale-detection"),
          payload: {
            provider: this.provider,
            lastMessageAge: age,
          },
        });
      }
    }, 5000);
  }

  private stopStaleDetection(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  private setState(newState: MarketStreamState): void {
    if (this.state === newState) return;
    this.state = newState;
    const status = this.getStatus();
    for (const handler of this.statusHandlers) {
      try {
        handler(status);
      } catch {
        // ignore handler errors
      }
    }
  }

  private emitEvent(event: NormalizedMarketEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // ignore handler errors
      }
    }
  }

  private emitError(error: MarketStreamError): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch {
        // ignore handler errors
      }
    }
  }

  private createMetadata(
    symbol: string,
    sourceChannel: string,
  ): MarketEventMetadata {
    return {
      eventId: randomUUID(),
      provider: this.provider,
      symbol,
      exchangeTimestamp: new Date(),
      receivedAt: new Date(),
      sourceChannel,
      schemaVersion: 1,
    };
  }
}
