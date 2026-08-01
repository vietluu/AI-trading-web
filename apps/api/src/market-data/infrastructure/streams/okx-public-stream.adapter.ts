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
 * Maps interval to OKX channel format (e.g. "1m", "5m")
 * OKX uses same string format for interval args: "1m", "5m", "1H" etc.
 */
function toOkxInterval(interval: ExchangeInterval): string {
  const map: Record<string, string> = {
    "1m": "1m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1H",
    "2h": "2H",
    "4h": "4H",
    "6h": "6H",
    "8h": "8H",
    "12h": "12H",
    "1d": "1D",
    "1w": "1W",
    "1M": "1M",
  };
  return map[interval] ?? interval;
}

/**
 * OKX streams use "BTC-USDT-SWAP" format.
 */
function toOkxSymbol(symbol: string): string {
  if (symbol.includes("-SWAP")) return symbol;
  return `${symbol}-SWAP`;
}

/**
 * Normalizes back to "BTC-USDT"
 */
function fromOkxSymbol(symbol: string): string {
  return symbol.replace("-SWAP", "");
}

interface OkxSubscriptionArg {
  channel: string;
  instId: string;
}

@Injectable()
export class OkxPublicStreamAdapter implements PublicMarketStreamAdapter {
  readonly provider = ExchangeProvider.OKX_FUTURES;
  private readonly logger = new Logger(OkxPublicStreamAdapter.name);

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

  private readonly activeSubscriptions = new Map<string, OkxSubscriptionArg>();
  private pendingSubscriptions: OkxSubscriptionArg[] = [];

  private readonly baseUrl: string;
  private readonly staleAfterMs: number;
  private readonly maxReconnectDelay: number;
  private readonly baseReconnectDelay: number;
  private readonly maxReconnectAttempts: number;

  constructor(configService: ConfigService) {
    this.baseUrl =
      configService.get<string>("OKX_FUTURES_WS_URL") ??
      "wss://ws.okx.com:8443/ws/v5/public";
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

    this.ws = new WebSocket(this.baseUrl);

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
          this.handleMessage(data.toString());
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
        const reasonStr = reason.toString();
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

  async disconnect(): Promise<void> {
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
  }

  async subscribeTicker(symbols: string[]): Promise<void> {
    const args = symbols.map((s) => ({
      channel: "tickers",
      instId: toOkxSymbol(s),
    }));
    this.subscribe(args);
  }

  async subscribeCandles(subscriptions: CandleSubscription[]): Promise<void> {
    const args = subscriptions.map((sub) => ({
      channel: `candle${toOkxInterval(sub.interval)}`,
      instId: toOkxSymbol(sub.symbol),
    }));
    this.subscribe(args);
  }

  async subscribeTrades(symbols: string[]): Promise<void> {
    const args = symbols.map((s) => ({
      channel: "trades",
      instId: toOkxSymbol(s),
    }));
    this.subscribe(args);
  }

  async subscribeOrderBook(
    subscriptions: OrderBookSubscription[],
  ): Promise<void> {
    const args = subscriptions.map((sub) => ({
      channel: sub.depth > 5 ? "books" : "books5",
      instId: toOkxSymbol(sub.symbol),
    }));
    this.subscribe(args);
  }

  async unsubscribe(subscriptionIds: string[]): Promise<void> {
    const args = subscriptionIds
      .map((id) => this.activeSubscriptions.get(id))
      .filter((arg): arg is OkxSubscriptionArg => arg !== undefined);
    
    if (args.length === 0) return;

    for (const arg of args) {
      this.activeSubscriptions.delete(`${arg.channel}:${arg.instId}`);
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          op: "unsubscribe",
          args,
        }),
      );
    }
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
  private subscribe(args: OkxSubscriptionArg[]): void {
    for (const arg of args) {
      this.activeSubscriptions.set(`${arg.channel}:${arg.instId}`, arg);
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(args);
    } else {
      this.pendingSubscriptions.push(...args);
    }
  }

  private sendSubscribe(args: OkxSubscriptionArg[]): void {
    this.ws?.send(
      JSON.stringify({
        op: "subscribe",
        args,
      }),
    );
  }

  private handleMessage(raw: string): void {
    if (raw === "pong") return;
    
    const parsed = JSON.parse(raw);

    // Event responses
    if (parsed.event === "subscribe" || parsed.event === "unsubscribe") {
      return;
    }
    if (parsed.event === "error") {
      this.logger.error({ event: 'okx_stream_error', msg: parsed.msg, code: parsed.code });
      return;
    }

    if (!parsed.arg || !parsed.data) return;

    const channel = parsed.arg.channel;
    const data = parsed.data;

    if (channel === "tickers") {
      this.handleTickerMessage(data);
    } else if (channel.startsWith("candle")) {
      this.handleKlineMessage(data, channel, parsed.arg.instId);
    } else if (channel === "trades") {
      this.handleTradeMessage(data);
    } else if (channel.startsWith("books")) {
      this.handleOrderBookMessage(data, parsed.arg.instId);
    }
  }

  private handleTickerMessage(dataArray: any[]): void {
    for (const data of dataArray) {
      const symbol = fromOkxSymbol(data.instId);
      const ticker: NormalizedTicker = {
        provider: this.provider,
        symbol,
        lastPrice: String(data.last),
        bidPrice: String(data.bidPx),
        askPrice: String(data.askPx),
        bidQuantity: String(data.bidSz),
        askQuantity: String(data.askSz),
        high24h: String(data.high24h),
        low24h: String(data.low24h),
        volume24h: String(data.vol24h),
        quoteVolume24h: String(data.volCcy24h),
        timestamp: new Date(Number(data.ts)),
      };

      this.emitEvent({
        type: MarketEventType.TICKER_UPDATED,
        metadata: this.createMetadata(symbol, `tickers`),
        payload: ticker,
      });
    }
  }

  private handleKlineMessage(dataArray: any[], channel: string, instId: string): void {
    const symbol = fromOkxSymbol(instId);
    // channel format: candle1m, candle5m, etc.
    const intervalRaw = channel.replace("candle", "");
    // Reverse map "1H" -> "1h"
    const intervalMap: Record<string, string> = {
      "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
      "1H": "1h", "2H": "2h", "4H": "4h", "6H": "6h", "8H": "8h", "12H": "12h",
      "1D": "1d", "1W": "1w", "1M": "1M",
    };
    const interval = (intervalMap[intervalRaw] ?? intervalRaw) as ExchangeInterval;

    for (const data of dataArray) {
      const [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm] = data;
      const isClosed = confirm === "1";

      const candle: NormalizedCandle = {
        provider: this.provider,
        symbol,
        interval,
        openTime: new Date(Number(ts)),
        // Estimate close time based on open time and interval
        closeTime: new Date(Number(ts) + this.intervalToMs(interval) - 1),
        open: String(o),
        high: String(h),
        low: String(l),
        close: String(c),
        volume: String(vol),
        quoteVolume: String(volCcy),
        isClosed,
      };

      this.emitEvent({
        type: isClosed
          ? MarketEventType.CANDLE_CLOSED
          : MarketEventType.CANDLE_UPDATED,
        metadata: this.createMetadata(symbol, channel),
        payload: candle,
      });
    }
  }

  private handleTradeMessage(dataArray: any[]): void {
    for (const data of dataArray) {
      const symbol = fromOkxSymbol(data.instId);
      const trade: NormalizedTrade = {
        provider: this.provider,
        symbol,
        tradeId: String(data.tradeId),
        price: String(data.px),
        quantity: String(data.sz),
        side: data.side === "sell" ? "SELL" : "BUY",
        timestamp: new Date(Number(data.ts)),
      };

      this.emitEvent({
        type: MarketEventType.PUBLIC_TRADE_RECEIVED,
        metadata: this.createMetadata(symbol, `trades`),
        payload: trade,
      });
    }
  }

  private handleOrderBookMessage(dataArray: any[], instId: string): void {
    const symbol = fromOkxSymbol(instId);
    
    for (const data of dataArray) {
      const bids = (data.bids as string[][])?.map((b) => ({
        price: b[0],
        quantity: b[1],
      })) ?? [];
      const asks = (data.asks as string[][])?.map((a) => ({
        price: a[0],
        quantity: a[1],
      })) ?? [];

      const book: NormalizedOrderBook = {
        provider: this.provider,
        symbol,
        bids,
        asks,
        timestamp: new Date(Number(data.ts)),
        depth: Math.max(bids.length, asks.length),
      };

      this.emitEvent({
        type: MarketEventType.ORDER_BOOK_UPDATED,
        metadata: this.createMetadata(symbol, `books`),
        payload: book,
      });
    }
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
      this.pendingSubscriptions = Array.from(this.activeSubscriptions.values());
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
      // Send ping
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send("ping");
      }

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
    }, 15000);
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

  private intervalToMs(interval: string): number {
    const value = parseInt(interval, 10);
    if (interval.endsWith("m")) return value * 60 * 1000;
    if (interval.endsWith("h")) return value * 60 * 60 * 1000;
    if (interval.endsWith("d")) return value * 24 * 60 * 60 * 1000;
    if (interval.endsWith("w")) return value * 7 * 24 * 60 * 60 * 1000;
    return value * 60 * 1000; // default
  }
}
