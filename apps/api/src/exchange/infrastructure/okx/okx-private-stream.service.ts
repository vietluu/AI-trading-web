import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import WebSocket from "ws";

import { PublicExchangeService } from "../../application/public-exchange.service";
import {
  ExchangeEnvironment,
  ExchangeProvider,
  type ExchangeAccountSummary,
  type ExchangeBalance,
  type ExchangeCredentials,
  type ExchangeOrder,
  type ExchangePosition,
  type OrderStatus,
  type OrderType,
  type PositionSide,
} from "../../domain/exchange.types";
import { fromOkxSymbol } from "../exchange-symbol";
import { OkxSignatureService } from "./okx-signature.service";

type JsonRecord = Record<string, unknown>;

interface StreamState {
  connectionId: string;
  credentials: ExchangeCredentials;
  ws?: WebSocket;
  connected: boolean;
  stopped: boolean;
  reconnectAttempts: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  heartbeat?: ReturnType<typeof setInterval>;
  lastMessageAt: number;
  instruments: Map<string, string | undefined>;
  account?: ExchangeAccountSummary;
  balances?: ExchangeBalance[];
  positions: Map<string, ExchangePosition>;
  positionsInitialized: boolean;
  orders: Map<string, ExchangeOrder>;
  ordersSeeded: boolean;
  disconnectedAt?: number;
}

/**
 * Ephemeral OKX private-account cache. Nothing in this service is persisted:
 * REST seeds/recovery snapshots live only in memory and WebSocket events keep
 * them current between recovery reads.
 */
@Injectable()
export class OkxPrivateStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(OkxPrivateStreamService.name);
  private readonly states = new Map<string, StreamState>();
  private readonly starting = new Map<string, Promise<StreamState>>();
  private readonly productionUrl: string;
  private readonly demoUrl: string;
  private readonly staleFallbackMs: number;

  constructor(
    private readonly signatures: OkxSignatureService,
    private readonly publicExchange: PublicExchangeService,
    config: ConfigService,
  ) {
    this.productionUrl =
      config.get<string>("OKX_WS_PRIVATE_URL") ??
      "wss://ws.okx.com:8443/ws/v5/private";
    this.demoUrl =
      config.get<string>("OKX_DEMO_WS_PRIVATE_URL") ??
      "wss://wspap.okx.com:8443/ws/v5/private?brokerId=9999";
    this.staleFallbackMs =
      config.get<number>("OKX_PRIVATE_WS_STALE_FALLBACK_MS") ?? 30_000;
  }

  async account(
    connectionId: string,
    credentials: ExchangeCredentials,
    fallback: () => Promise<ExchangeAccountSummary>,
  ): Promise<ExchangeAccountSummary> {
    const state = await this.ensure(connectionId, credentials);
    if (state.account && this.usable(state)) return state.account;
    const value = await fallback();
    state.account = value;
    state.lastMessageAt = Date.now();
    return value;
  }

  async balances(
    connectionId: string,
    credentials: ExchangeCredentials,
    fallback: () => Promise<ExchangeBalance[]>,
  ): Promise<ExchangeBalance[]> {
    const state = await this.ensure(connectionId, credentials);
    if (state.balances && this.usable(state)) return state.balances;
    const value = await fallback();
    state.balances = value;
    state.lastMessageAt = Date.now();
    return value;
  }

  async positions(
    connectionId: string,
    credentials: ExchangeCredentials,
    fallback: () => Promise<ExchangePosition[]>,
  ): Promise<ExchangePosition[]> {
    const state = await this.ensure(connectionId, credentials);
    if (state.positionsInitialized && this.usable(state)) {
      return [...state.positions.values()];
    }
    const values = await fallback();
    state.positions = new Map(values.map((item) => [this.positionKey(item), item]));
    state.positionsInitialized = true;
    state.lastMessageAt = Date.now();
    return values;
  }

  async openOrders(
    connectionId: string,
    credentials: ExchangeCredentials,
    fallback: () => Promise<ExchangeOrder[]>,
  ): Promise<ExchangeOrder[]> {
    const state = await this.ensure(connectionId, credentials);
    if (state.ordersSeeded && this.usable(state)) return [...state.orders.values()];
    const values = await fallback();
    state.orders = new Map(values.map((item) => [item.exchangeOrderId, item]));
    state.ordersSeeded = true;
    state.lastMessageAt = Date.now();
    return values;
  }

  invalidate(connectionId: string): void {
    const state = this.states.get(connectionId);
    if (!state) return;
    state.stopped = true;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    if (state.heartbeat) clearInterval(state.heartbeat);
    state.ws?.close();
    this.states.delete(connectionId);
  }

  onModuleDestroy(): void {
    for (const connectionId of [...this.states.keys()]) this.invalidate(connectionId);
  }

  private async ensure(
    connectionId: string,
    credentials: ExchangeCredentials,
  ): Promise<StreamState> {
    const existing = this.states.get(connectionId);
    if (existing) return existing;
    const pending = this.starting.get(connectionId);
    if (pending) return pending;
    const start = (async () => {
      const instruments = await this.publicExchange
        .instruments(ExchangeProvider.OKX_FUTURES)
        .catch(() => []);
      const state: StreamState = {
        connectionId,
        credentials,
        connected: false,
        stopped: false,
        reconnectAttempts: 0,
        lastMessageAt: 0,
        instruments: new Map(
          instruments.map((item) => [
            `${item.symbol}-SWAP`,
            item.contractSize,
          ]),
        ),
        positions: new Map(),
        positionsInitialized: false,
        orders: new Map(),
        ordersSeeded: false,
      };
      this.states.set(connectionId, state);
      this.connect(state);
      return state;
    })();
    this.starting.set(connectionId, start);
    try {
      return await start;
    } finally {
      this.starting.delete(connectionId);
    }
  }

  private connect(state: StreamState): void {
    if (state.stopped) return;
    const url =
      state.credentials.environment === ExchangeEnvironment.DEMO
        ? this.demoUrl
        : this.productionUrl;
    const ws = new WebSocket(url);
    state.ws = ws;
    ws.on("open", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      ws.send(
        JSON.stringify({
          op: "login",
          args: [
            {
              apiKey: state.credentials.apiKey,
              passphrase: state.credentials.passphrase ?? "",
              timestamp,
              sign: this.signatures.sign(
                timestamp,
                "GET",
                "/users/self/verify",
                "",
                state.credentials.apiSecret,
              ),
            },
          ],
        }),
      );
    });
    ws.on("message", (data) => {
      const payload =
        typeof data === "string"
          ? data
          : Buffer.isBuffer(data)
            ? data.toString("utf8")
            : Array.isArray(data)
              ? data.map((item) => (Buffer.isBuffer(item) ? item.toString("utf8") : JSON.stringify(item))).join("")
              : JSON.stringify(data);
      this.handleMessage(state, payload);
    });
    ws.on("close", () => this.disconnected(state));
    ws.on("error", (error) => {
      this.logger.warn({
        event: "okx_private_stream_error",
        connectionId: state.connectionId,
        message: typeof error === "object" && error && "message" in error
          ? String(error.message)
          : String(error),
      });
    });
  }

  private handleMessage(state: StreamState, raw: string): void {
    state.lastMessageAt = Date.now();
    if (raw === "pong") return;
    let message: JsonRecord;
    try {
      message = JSON.parse(raw) as JsonRecord;
    } catch {
      return;
    }
    if (message.event === "login") {
      if (message.code && message.code !== "0") {
        this.logger.error({
          event: "okx_private_stream_login_failed",
          connectionId: state.connectionId,
          code: message.code,
        });
        state.ws?.close();
        return;
      }
      state.connected = true;
      state.reconnectAttempts = 0;
      state.disconnectedAt = undefined;
      state.ws?.send(
        JSON.stringify({
          op: "subscribe",
          args: [
            {
              channel: "account",
              extraParams: JSON.stringify({ updateInterval: "0" }),
            },
            {
              channel: "positions",
              instType: "ANY",
              extraParams: JSON.stringify({ updateInterval: "0" }),
            },
            { channel: "orders", instType: "SWAP" },
          ],
        }),
      );
      this.startHeartbeat(state);
      this.logger.log({
        event: "okx_private_stream_connected",
        connectionId: state.connectionId,
      });
      return;
    }
    if (message.event === "error") {
      this.logger.warn({
        event: "okx_private_stream_subscription_failed",
        connectionId: state.connectionId,
        code: message.code,
      });
      return;
    }
    const arg = this.record(message.arg);
    const data = Array.isArray(message.data)
      ? message.data.map((item) => this.record(item)).filter(Boolean) as JsonRecord[]
      : [];
    if (arg?.channel === "account") this.updateAccount(state, data);
    if (arg?.channel === "positions") this.updatePositions(state, data);
    if (arg?.channel === "orders") this.updateOrders(state, data);
  }

  private updateAccount(state: StreamState, data: JsonRecord[]): void {
    const value = data[0];
    if (!value) return;
    const details = Array.isArray(value.details)
      ? value.details.map((item) => this.record(item)).filter(Boolean) as JsonRecord[]
      : [];
    const settlement =
      details.find((item) => item.ccy === "USDT") ?? details[0];
    const updatedAt = this.date(value.uTime);
    const availableBalance = this.firstNonEmptyText(
      settlement?.availBal,
      settlement?.availEq,
      value.availEq,
      settlement?.cashBal,
      settlement?.eq,
      value.totalEq,
      "0",
    );
    const totalEquity = this.firstNonEmptyText(
      value.totalEq,
      settlement?.eq,
      settlement?.cashBal,
      "0",
    );
    const totalUnrealizedPnl = this.firstNonEmptyText(
      value.upl,
      settlement?.upl,
      "0",
    );
    state.account = {
      provider: ExchangeProvider.OKX_FUTURES,
      totalEquity,
      availableBalance,
      totalUnrealizedPnl,
      totalMarginBalance: totalEquity,
      canTrade: true,
      updatedAt,
    };
    state.balances = details.map((item) => ({
      provider: ExchangeProvider.OKX_FUTURES,
      asset: this.text(item.ccy),
      total: this.firstNonEmptyText(item.cashBal, item.eq, "0"),
      available: this.firstNonEmptyText(item.availBal, item.availEq, item.cashBal, item.eq, "0"),
      ...(item.frozenBal ? { locked: this.text(item.frozenBal) } : {}),
      ...(item.upl ? { unrealizedPnl: this.text(item.upl) } : {}),
      ...(item.eq ? { marginBalance: this.text(item.eq) } : {}),
    }));
  }

  private updatePositions(state: StreamState, data: JsonRecord[]): void {
    state.positionsInitialized = true;
    for (const item of data) {
      const instId = this.text(item.instId);
      const rawQuantity = this.text(item.pos);
      const posSide = this.text(item.posSide);
      const key = `${instId}:${posSide}`;
      if (!instId || Number(rawQuantity) === 0) {
        state.positions.delete(key);
        continue;
      }
      let symbol: string;
      try {
        symbol = fromOkxSymbol(instId);
      } catch {
        continue;
      }
      const contracts = Math.abs(Number(rawQuantity));
      const contractSize = Number(state.instruments.get(instId) ?? 1);
      const quantity = String(contracts * contractSize);
      const side: PositionSide =
        posSide === "long"
          ? "LONG"
          : posSide === "short"
            ? "SHORT"
            : rawQuantity.startsWith("-")
              ? "SHORT"
              : "LONG";
      state.positions.set(key, {
        provider: ExchangeProvider.OKX_FUTURES,
        symbol,
        side,
        positionMode: posSide === "net" ? "ONE_WAY" : "HEDGE",
        quantity,
        entryPrice: this.text(item.avgPx),
        ...(item.markPx ? { markPrice: this.text(item.markPx) } : {}),
        ...(item.liqPx ? { liquidationPrice: this.text(item.liqPx) } : {}),
        ...(item.lever ? { leverage: this.text(item.lever) } : {}),
        ...(item.mgnMode
          ? {
              marginType:
                item.mgnMode === "isolated" ? ("ISOLATED" as const) : ("CROSS" as const),
            }
          : {}),
        ...(item.margin ? { margin: this.text(item.margin) } : {}),
        unrealizedPnl: this.text(item.upl),
        ...(item.realizedPnl ? { realizedPnl: this.text(item.realizedPnl) } : {}),
        ...(item.notionalUsd ? { notional: this.text(item.notionalUsd) } : {}),
        updatedAt: this.date(item.uTime),
      });
    }
  }

  private updateOrders(state: StreamState, data: JsonRecord[]): void {
    for (const item of data) {
      const order = this.order(item);
      if (!order) continue;
      if (["FILLED", "CANCELED", "REJECTED", "EXPIRED"].includes(order.status)) {
        state.orders.delete(order.exchangeOrderId);
      } else {
        state.orders.set(order.exchangeOrderId, order);
      }
    }
  }

  private order(item: JsonRecord): ExchangeOrder | undefined {
    const instId = this.text(item.instId);
    const exchangeOrderId = this.text(item.ordId);
    if (!instId || !exchangeOrderId) return undefined;
    let symbol: string;
    try {
      symbol = fromOkxSymbol(instId);
    } catch {
      return undefined;
    }
    const state = this.text(item.state);
    const status: OrderStatus =
      state === "live"
        ? "NEW"
        : state === "partially_filled"
          ? "PARTIALLY_FILLED"
          : state === "filled"
            ? "FILLED"
            : state === "canceled" || state === "mmp_canceled"
              ? "CANCELED"
              : state === "order_failed"
                ? "REJECTED"
                : "UNKNOWN";
    const rawType = this.text(item.ordType);
    const type: OrderType =
      rawType === "market"
        ? "MARKET"
        : ["limit", "post_only", "fok", "ioc"].includes(rawType)
          ? "LIMIT"
          : rawType.includes("trigger")
            ? "STOP"
            : "UNKNOWN";
    return {
      provider: ExchangeProvider.OKX_FUTURES,
      symbol,
      exchangeOrderId,
      ...(item.clOrdId ? { clientOrderId: this.text(item.clOrdId) } : {}),
      side: item.side === "sell" ? "SELL" : "BUY",
      type,
      status,
      ...(rawType === "post_only" ? { timeInForce: "POST_ONLY" as const } : {}),
      ...(item.px ? { price: this.text(item.px) } : {}),
      ...(item.triggerPx ? { stopPrice: this.text(item.triggerPx) } : {}),
      ...(item.avgPx ? { averagePrice: this.text(item.avgPx) } : {}),
      originalQuantity: this.text(item.sz),
      executedQuantity: this.text(item.accFillSz),
      ...(item.reduceOnly === undefined
        ? {}
        : { reduceOnly: item.reduceOnly === true || item.reduceOnly === "true" }),
      ...(item.posSide
        ? { positionSide: this.positionSide(this.text(item.posSide)) }
        : {}),
      ...(item.cTime ? { createdAt: this.date(item.cTime) } : {}),
      ...(item.uTime ? { updatedAt: this.date(item.uTime) } : {}),
    };
  }

  private disconnected(state: StreamState): void {
    state.connected = false;
    state.disconnectedAt = Date.now();
    if (state.heartbeat) clearInterval(state.heartbeat);
    state.heartbeat = undefined;
    if (state.stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** state.reconnectAttempts++);
    state.reconnectTimer = setTimeout(() => this.connect(state), delay);
    state.reconnectTimer.unref();
  }

  private startHeartbeat(state: StreamState): void {
    if (state.heartbeat) clearInterval(state.heartbeat);
    state.heartbeat = setInterval(() => {
      if (state.ws?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - state.lastMessageAt > 30_000) {
        state.ws.terminate();
        return;
      }
      state.ws.send("ping");
    }, 20_000);
    state.heartbeat.unref();
  }

  private usable(state: StreamState): boolean {
    return (
      state.connected ||
      (state.disconnectedAt !== undefined &&
        Date.now() - state.disconnectedAt <= this.staleFallbackMs)
    );
  }

  private positionKey(position: ExchangePosition): string {
    return `${position.symbol}-SWAP:${position.side.toLowerCase()}`;
  }

  private positionSide(value: string): PositionSide {
    if (value === "long") return "LONG";
    if (value === "short") return "SHORT";
    return "BOTH";
  }

  private record(value: unknown): JsonRecord | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : undefined;
  }

  private text(value: unknown): string {
    if (typeof value === "string") {
      return value.trim() === "" ? "0" : value;
    }
    return typeof value === "number" ? String(value) : "0";
  }

  private firstNonEmptyText(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === "string" && value.trim() !== "") {
        return value.trim();
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }
    return "0";
  }

  private date(value: unknown): Date {
    const timestamp = Number(value);
    return new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now());
  }
}
