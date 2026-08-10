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
  NormalizedOrderBookLevel,
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

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isOkxSubscriptionArg(value: unknown): value is OkxSubscriptionArg {
  return (
    isRecord(value) &&
    typeof value.channel === "string" &&
    typeof value.instId === "string"
  );
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return undefined;
}

function toTimestampDate(value: unknown): Date | null {
  const numeric =
    typeof value === "string" || typeof value === "number"
      ? Number(value)
      : Number.NaN;

  return Number.isFinite(numeric) ? new Date(numeric) : null;
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
export class OkxPublicStreamAdapter implements PublicMarketStreamAdapter {
  readonly provider = ExchangeProvider.OKX_FUTURES;
  private readonly logger = new Logger(OkxPublicStreamAdapter.name);

  private publicWs: WebSocket | null = null;
  private businessWs: WebSocket | null = null;
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
  private readonly baseUrl: string;
  private readonly businessUrl: string;
  private readonly staleAfterMs: number;
  private readonly maxReconnectDelay: number;
  private readonly baseReconnectDelay: number;
  private readonly maxReconnectAttempts: number;

  constructor(configService: ConfigService) {
    this.baseUrl =
      configService.get<string>("OKX_WS_PUBLIC_URL") ??
      "wss://ws.okx.com:8443/ws/v5/public";
    this.businessUrl =
      configService.get<string>("OKX_WS_BUSINESS_URL") ??
      "wss://ws.okx.com:8443/ws/v5/business";
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

    const publicWs = new WebSocket(this.baseUrl);
    const businessWs = new WebSocket(this.businessUrl);
    this.publicWs = publicWs;
    this.businessWs = businessWs;

    return new Promise<void>((resolve, reject) => {
      let publicOpen = false;
      let businessOpen = false;
      let settled = false;
      const timeout = setTimeout(() => {
        settled = true;
        reject(
          new MarketDataError(
            MarketIncidentCode.PROVIDER_UNAVAILABLE,
            this.provider,
            "Connection timeout",
          ),
        );
      }, 15000);

      const onOpen = (kind: "public" | "business") => {
        if (kind === "public") publicOpen = true;
        else businessOpen = true;
        if (!publicOpen || !businessOpen || settled) return;

        settled = true;
        clearTimeout(timeout);
        this.connectedAt = new Date();
        this.currentReconnectDelay = this.baseReconnectDelay;
        this.setState(MarketStreamState.CONNECTED);
        this.startStaleDetection();
        this.replaySubscriptions();

        this.emitEvent({
          type: MarketEventType.STREAM_CONNECTED,
          metadata: this.createMetadata("", "connection"),
          payload: { provider: this.provider },
        });

        resolve();
      };

      const attachHandlers = (
        ws: WebSocket,
        kind: "public" | "business",
      ) => {
        ws.on("open", () => onOpen(kind));

        ws.on("message", (data: WebSocket.Data) => {
          this.lastMessageAt = new Date();
          this.messageCount++;
          try {
            this.handleMessage(toWebSocketMessage(data));
          } catch {
            this.malformedMessageCount++;
          }
        });

        ws.on("error", (error: Error) => {
          this.logger.error({
            event: "ws_error",
            stream: kind,
            message: error.message,
          });
          this.lastErrorCode = "WS_ERROR";
          this.lastErrorAt = new Date();
          this.emitError({
            provider: this.provider,
            code: "WS_ERROR",
            message: `${kind}: ${error.message}`,
            timestamp: new Date(),
            recoverable: true,
          });
        });

        ws.on("close", (code: number, reason: Buffer) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(
              new MarketDataError(
                MarketIncidentCode.PROVIDER_UNAVAILABLE,
                this.provider,
                `${kind} stream closed during connection`,
              ),
            );
          }
          this.stopStaleDetection();
          const reasonStr = Buffer.isBuffer(reason)
            ? reason.toString("utf8")
            : String(reason);
          this.logger.warn({
            event: "ws_close",
            stream: kind,
            code,
            reason: reasonStr,
          });

          this.emitEvent({
            type: MarketEventType.STREAM_DISCONNECTED,
            metadata: this.createMetadata("", "connection"),
            payload: {
              provider: this.provider,
              reason: `${kind} ${code}: ${reasonStr}`,
            },
          });

          if (this.state !== MarketStreamState.DISCONNECTED) {
            this.scheduleReconnect();
          }
        });
      };

      attachHandlers(publicWs, "public");
      attachHandlers(businessWs, "business");
    });
  }

  disconnect(): Promise<void> {
    this.setState(MarketStreamState.DISCONNECTED);
    this.stopStaleDetection();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const ws of [this.publicWs, this.businessWs]) {
      if (!ws) continue;
      ws.removeAllListeners();
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close(1000, "Client disconnect");
      }
    }
    this.publicWs = null;
    this.businessWs = null;
    this.activeSubscriptions.clear();
    return Promise.resolve();
  }

  subscribeTicker(symbols: string[]): Promise<void> {
    const args = symbols.map((s) => ({
      channel: "tickers",
      instId: toOkxSymbol(s),
    }));
    this.subscribe(args);
    return Promise.resolve();
  }

  subscribeCandles(subscriptions: CandleSubscription[]): Promise<void> {
    const args = subscriptions.map((sub) => ({
      channel: `candle${toOkxInterval(sub.interval)}`,
      instId: toOkxSymbol(sub.symbol),
    }));
    this.subscribe(args);
    return Promise.resolve();
  }

  subscribeTrades(symbols: string[]): Promise<void> {
    const args = symbols.map((s) => ({
      channel: "trades",
      instId: toOkxSymbol(s),
    }));
    this.subscribe(args);
    return Promise.resolve();
  }

  subscribeOrderBook(
    subscriptions: OrderBookSubscription[],
  ): Promise<void> {
    const args = subscriptions.map((sub) => ({
      channel: sub.depth > 5 ? "books" : "books5",
      instId: toOkxSymbol(sub.symbol),
    }));
    this.subscribe(args);
    return Promise.resolve();
  }

  unsubscribe(subscriptionIds: string[]): Promise<void> {
    const args = subscriptionIds
      .map((id) => this.activeSubscriptions.get(id))
      .filter((arg): arg is OkxSubscriptionArg => arg !== undefined);

    if (args.length === 0) return Promise.resolve();

    for (const arg of args) {
      this.activeSubscriptions.delete(`${arg.channel}:${arg.instId}`);
    }

    this.sendByStream("unsubscribe", args);
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
  private subscribe(args: OkxSubscriptionArg[]): void {
    for (const arg of args) {
      this.activeSubscriptions.set(`${arg.channel}:${arg.instId}`, arg);
    }
    this.sendByStream("subscribe", args);
  }

  private replaySubscriptions(): void {
    this.sendByStream("subscribe", Array.from(this.activeSubscriptions.values()));
  }

  private sendByStream(
    op: "subscribe" | "unsubscribe",
    args: OkxSubscriptionArg[],
  ): void {
    const publicArgs = args.filter((arg) => !arg.channel.startsWith("candle"));
    const businessArgs = args.filter((arg) => arg.channel.startsWith("candle"));

    if (publicArgs.length > 0 && this.publicWs?.readyState === WebSocket.OPEN) {
      this.publicWs.send(JSON.stringify({ op, args: publicArgs }));
    }
    if (
      businessArgs.length > 0 &&
      this.businessWs?.readyState === WebSocket.OPEN
    ) {
      this.businessWs.send(JSON.stringify({ op, args: businessArgs }));
    }
  }

  private handleMessage(raw: string): void {
    if (raw === "pong") return;

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return;

    // Event responses
    if (parsed.event === "subscribe" || parsed.event === "unsubscribe") {
      return;
    }
    if (parsed.event === "error") {
      this.logger.error({
        event: "okx_stream_error",
        msg: toStringValue(parsed.msg) ?? "OKX stream error",
        code: toStringValue(parsed.code) ?? "OKX_ERROR",
      });
      return;
    }

    if (!isOkxSubscriptionArg(parsed.arg) || !isUnknownArray(parsed.data)) {
      return;
    }

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

  private handleTickerMessage(dataArray: unknown[]): void {
    for (const data of dataArray) {
      if (!isRecord(data)) continue;
      const symbolValue = toStringValue(data.instId);
      const timestamp = toTimestampDate(data.ts);
      if (!symbolValue || !timestamp) continue;

      const symbol = fromOkxSymbol(symbolValue);
      const lastPrice = Number(toStringValue(data.last));
      const openPrice = Number(toStringValue(data.open24h));
      const priceChange = lastPrice - openPrice;
      const priceChangePercent = openPrice > 0
        ? (priceChange / openPrice) * 100
        : undefined;
      const ticker: NormalizedTicker = {
        provider: this.provider,
        symbol,
        lastPrice: toStringValue(data.last) ?? "",
        bidPrice: toStringValue(data.bidPx),
        askPrice: toStringValue(data.askPx),
        bidQuantity: toStringValue(data.bidSz),
        askQuantity: toStringValue(data.askSz),
        high24h: toStringValue(data.high24h),
        low24h: toStringValue(data.low24h),
        volume24h: toStringValue(data.vol24h),
        quoteVolume24h: toStringValue(data.volCcy24h),
        ...(Number.isFinite(priceChange)
          ? { priceChange24h: String(priceChange) }
          : {}),
        ...(priceChangePercent !== undefined && Number.isFinite(priceChangePercent)
          ? { priceChangePercent24h: String(priceChangePercent) }
          : {}),
        timestamp,
      };

      this.emitEvent({
        type: MarketEventType.TICKER_UPDATED,
        metadata: this.createMetadata(symbol, `tickers`),
        payload: ticker,
      });
    }
  }

  private handleKlineMessage(
    dataArray: unknown[],
    channel: string,
    instId: string,
  ): void {
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
      if (!isUnknownArray(data) || data.length < 9) continue;
      const timestamp = toTimestampDate(data[0]);
      if (!timestamp) continue;
      const isClosed = toStringValue(data[8]) === "1";

      const candle: NormalizedCandle = {
        provider: this.provider,
        symbol,
        interval,
        openTime: timestamp,
        // Estimate close time based on open time and interval
        closeTime: new Date(timestamp.getTime() + this.intervalToMs(interval) - 1),
        open: toStringValue(data[1]) ?? "",
        high: toStringValue(data[2]) ?? "",
        low: toStringValue(data[3]) ?? "",
        close: toStringValue(data[4]) ?? "",
        volume: toStringValue(data[5]) ?? "",
        quoteVolume: toStringValue(data[6]),
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

  private handleTradeMessage(dataArray: unknown[]): void {
    for (const data of dataArray) {
      if (!isRecord(data)) continue;
      const symbolValue = toStringValue(data.instId);
      const timestamp = toTimestampDate(data.ts);
      if (!symbolValue || !timestamp) continue;

      const symbol = fromOkxSymbol(symbolValue);
      const trade: NormalizedTrade = {
        provider: this.provider,
        symbol,
        tradeId: toStringValue(data.tradeId) ?? "",
        price: toStringValue(data.px) ?? "",
        quantity: toStringValue(data.sz) ?? "",
        side: data.side === "sell" ? "SELL" : "BUY",
        timestamp,
      };

      this.emitEvent({
        type: MarketEventType.PUBLIC_TRADE_RECEIVED,
        metadata: this.createMetadata(symbol, `trades`),
        payload: trade,
      });
    }
  }

  private handleOrderBookMessage(dataArray: unknown[], instId: string): void {
    const symbol = fromOkxSymbol(instId);
    
    for (const data of dataArray) {
      if (!isRecord(data)) continue;
      const timestamp = toTimestampDate(data.ts);
      if (!timestamp) continue;
      const bids = this.parseOrderBookLevels(data.bids);
      const asks = this.parseOrderBookLevels(data.asks);

      const book: NormalizedOrderBook = {
        provider: this.provider,
        symbol,
        bids,
        asks,
        timestamp,
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
      this.state === MarketStreamState.RECONNECTING ||
      this.state === MarketStreamState.DISCONNECTED
    ) {
      return;
    }
    if (
      this.maxReconnectAttempts > 0 &&
      this.reconnectCount >= this.maxReconnectAttempts
    ) {
      this.setState(MarketStreamState.FAILED);
      return;
    }

    this.setState(MarketStreamState.RECONNECTING);
    for (const ws of [this.publicWs, this.businessWs]) {
      if (!ws) continue;
      ws.removeAllListeners();
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close(1000, "Reconnect both OKX streams");
      }
    }
    this.publicWs = null;
    this.businessWs = null;
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
      for (const ws of [this.publicWs, this.businessWs]) {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send("ping");
        }
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

  private parseOrderBookLevels(levels: unknown): NormalizedOrderBookLevel[] {
    if (!isUnknownArray(levels)) return [];

    const parsedLevels: NormalizedOrderBookLevel[] = [];
    for (const level of levels) {
      if (!isUnknownArray(level) || level.length < 2) continue;
      const price = toStringValue(level[0]);
      const quantity = toStringValue(level[1]);
      if (!price || !quantity) continue;

      parsedLevels.push({ price, quantity });
    }

    return parsedLevels;
  }
}
