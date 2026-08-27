import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";

import type { ExchangeAdapter } from "../../domain/exchange.adapter";
import { ExchangeError, ExchangeErrorCode } from "../../domain/exchange.error";
import { normalizeClientOrderId } from "../client-order-id";
import {
  ExchangeEnvironment,
  ExchangeInterval,
  ExchangeProvider,
  type ExchangeAccountConfiguration,
  type ExchangeAccountSummary,
  type ExchangeBalance,
  type ExchangeConnectionTest,
  type ExchangeCredentials,
  type ExchangeFundingRate,
  type ExchangeFill,
  type ExchangeInfo,
  type ExchangeInstrument,
  type ExchangeKline,
  type ExchangeOpenInterest,
  type ExchangeOrder,
  type ExchangeOrderBook,
  type ExchangePosition,
  type ExchangeServerTime,
  type ExchangeTicker,
  type ExchangeTrade,
  type GetOrderQuery,
  type InstrumentQuery,
  type KlineQuery,
  type OpenOrderQuery,
  type PlaceOrderCommand,
  type CancelOrderCommand,
  type AmendProtectiveOrderCommand,
  type CancelProtectiveOrderCommand,
  type PlaceProtectiveOrderCommand,
  type ProtectiveOrderStatus,
  type OrderStatus,
  type OrderType,
  type PositionSide,
} from "../../domain/exchange.types";
import { toOkxInterval } from "../exchange-interval";
import { fromOkxSymbol, mapSymbol, toOkxSymbol } from "../exchange-symbol";
import { OkxFuturesClient } from "./okx-futures.client";

const decimal = z.string();
const instrumentSchema = z.object({
  instId: z.string(),
  instType: z.string(),
  state: z.string(),
  baseCcy: z.string().optional(),
  quoteCcy: z.string().optional(),
  settleCcy: z.string(),
  ctVal: decimal.optional(),
  tickSz: decimal,
  lotSz: decimal,
  minSz: decimal,
  maxMktSz: decimal.optional(),
  maxLmtSz: decimal.optional(),
});
const tickerSchema = z.object({
  instId: z.string(),
  last: decimal,
  bidPx: decimal,
  askPx: decimal,
  high24h: decimal,
  low24h: decimal,
  vol24h: decimal,
  volCcy24h: decimal,
  open24h: decimal,
  ts: z.string().regex(/^\d+$/),
});
const markSchema = z.object({
  instId: z.string(),
  markPx: decimal,
  ts: z.string().regex(/^\d+$/),
});
const bookSchema = z.object({
  bids: z.array(z.array(decimal)),
  asks: z.array(z.array(decimal)),
  ts: z.string().regex(/^\d+$/),
});
const tradeSchema = z.object({
  instId: z.string(),
  tradeId: z.string(),
  px: decimal,
  sz: decimal,
  side: z.string(),
  ts: z.string().regex(/^\d+$/),
});
const candleSchema = z.array(z.string()).min(6);
const fundingSchema = z.object({
  instId: z.string(),
  fundingRate: decimal,
  fundingTime: z.string().regex(/^\d+$/),
  nextFundingTime: z.string().regex(/^\d+$/).optional(),
});
const interestSchema = z.object({
  instId: z.string(),
  oi: decimal,
  oiUsd: decimal.optional(),
  ts: z.string().regex(/^\d+$/),
});
const balanceDetailSchema = z.object({
  ccy: z.string(),
  cashBal: decimal.optional().default("0"),
  availBal: decimal.optional().default("0"),
  availEq: decimal.optional(),
  frozenBal: decimal.optional(),
  upl: decimal.optional(),
  eq: decimal.optional(),
  eqUsd: decimal.optional(),
  borrowFroz: decimal.optional(),
  interest: decimal.optional(),
  liab: decimal.optional(),
  maxLoan: decimal.optional(),
  mgnRatio: decimal.optional(),
  notionalLever: decimal.optional(),
  ordFrozen: decimal.optional(),
  twap: decimal.optional(),
  uTime: z.string().optional(),
  uplLiab: decimal.optional(),
  crossLiab: decimal.optional(),
  isoLiab: decimal.optional(),
  isoEq: decimal.optional(),
  isoUpl: decimal.optional(),
  spotIsoBal: decimal.optional(),
  stgyEq: decimal.optional(),
  rewardBal: decimal.optional(),
  fixedBal: decimal.optional(),
  spotCopyTradingEq: decimal.optional(),
  spotInUseAmt: decimal.optional(),
});
const accountSchema = z.object({
  totalEq: decimal.optional().default("0"),
  availEq: decimal.optional(),
  upl: decimal.optional(),
  details: z.array(balanceDetailSchema).default([]),
  uTime: z.string().optional().default(() => String(Date.now())),
  adjEq: decimal.optional(),
  borrowFroz: decimal.optional(),
  imr: decimal.optional(),
  isoEq: decimal.optional(),
  mgnRatio: decimal.optional(),
  mmr: decimal.optional(),
  notionalUsd: decimal.optional(),
  ordFroz: decimal.optional(),
});
const positionSchema = z.object({
  instId: z.string(),
  pos: decimal,
  posSide: z.string(),
  avgPx: decimal,
  markPx: decimal.optional(),
  liqPx: decimal.optional(),
  lever: decimal.optional(),
  mgnMode: z.string().optional(),
  margin: decimal.optional(),
  upl: decimal,
  realizedPnl: decimal.optional(),
  notionalUsd: decimal.optional(),
  uTime: z.string().regex(/^\d+$/),
});
const orderSchema = z.object({
  instId: z.string(),
  ordId: z.string(),
  clOrdId: z.string().optional(),
  side: z.string(),
  ordType: z.string(),
  state: z.string(),
  px: decimal.optional(),
  triggerPx: decimal.optional(),
  avgPx: decimal.optional(),
  sz: decimal,
  accFillSz: decimal,
  reduceOnly: z.union([z.string(), z.boolean()]).optional(),
  posSide: z.string().optional(),
  source: z.string().optional(),
  algoClOrdId: z.string().optional(),
  algoId: z.string().optional(),
  category: z.string().optional(),
  cTime: z.string().regex(/^\d+$/).optional(),
  uTime: z.string().regex(/^\d+$/).optional(),
});
const fillSchema = z.object({
  instId: z.string(),
  tradeId: z.string(),
  billId: z.string().optional(),
  ordId: z.string(),
  clOrdId: z.string().optional(),
  side: z.string(),
  posSide: z.string().optional(),
  fillPx: decimal,
  fillSz: decimal,
  fillPnl: decimal.default("0"),
  fee: decimal.default("0"),
  feeCcy: z.string().optional(),
  execType: z.string().optional(),
  fillTime: z.string().regex(/^\d+$/).optional(),
  ts: z.string().regex(/^\d+$/).optional(),
});
const configSchema = z.object({
  posMode: z.string(),
  acctLv: z.string().optional(),
});
const orderAckSchema = z.object({
  ordId: z.string(),
  clOrdId: z.string().optional(),
  sCode: z.string(),
  sMsg: z.string().optional(),
});
const maximumOrderSizeSchema = z.object({
  instId: z.string(),
  maxBuy: decimal,
  maxSell: decimal,
});
const algoAckSchema = z.object({
  algoId: z.string().optional(),
  algoClOrdId: z.string().optional(),
  sCode: z.string(),
  sMsg: z.string().optional(),
});
const algoOrderDetailSchema = z.object({
  algoId: z.string().optional(),
  algoClOrdId: z.string().optional(),
  state: z.string(),
});

@Injectable()
export class OkxFuturesAdapter implements ExchangeAdapter {
  readonly provider = ExchangeProvider.OKX_FUTURES;
  private readonly logger = new Logger(OkxFuturesAdapter.name);

  constructor(
    private readonly client: OkxFuturesClient,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async testPublicConnection(): Promise<ExchangeConnectionTest> {
    const started = Date.now();
    const serverTime = await this.getServerTime();
    return {
      success: true,
      provider: this.provider,
      environment: ExchangeEnvironment.PRODUCTION,
      serverTime: serverTime.serverTime,
      latencyMs: Date.now() - started,
    };
  }

  async testPrivateConnection(
    credentials: ExchangeCredentials,
  ): Promise<ExchangeConnectionTest> {
    const started = Date.now();
    try {
      const [account, balances, positions, orders, serverTime] =
        await Promise.all([
          this.getAccountSummary(credentials),
          this.getBalances(credentials),
          this.getPositions(credentials),
          this.getOpenOrders(credentials),
          this.getServerTime(),
        ]);
      return {
        success: true,
        provider: this.provider,
        environment: credentials.environment,
        permissions: {
          accountRead: Boolean(account),
          balanceRead: Array.isArray(balances),
          positionRead: Array.isArray(positions),
          orderRead: Array.isArray(orders),
        },
        serverTime: serverTime.serverTime,
        latencyMs: Date.now() - started,
      };
    } catch (caught) {
      const error =
        caught instanceof ExchangeError
          ? caught
          : new ExchangeError(
              ExchangeErrorCode.UNKNOWN,
              this.provider,
              false,
              502,
              "Unexpected OKX response",
            );
      return {
        success: false,
        provider: this.provider,
        environment: credentials.environment,
        latencyMs: Date.now() - started,
        errorCode: error.code,
        message: error.message,
      };
    }
  }

  async getServerTime(): Promise<ExchangeServerTime> {
    const localTime = new Date();
    const serverTime = new Date(await this.client.serverTime());
    return {
      provider: this.provider,
      serverTime,
      localTime,
      offsetMs: serverTime.getTime() - localTime.getTime(),
    };
  }

  async getExchangeInfo(
    environment = ExchangeEnvironment.PRODUCTION,
  ): Promise<ExchangeInfo> {
    const instruments = await this.getInstruments();
    return {
      provider: this.provider,
      environment,
      timezone: "UTC",
      instrumentCount: instruments.length,
    };
  }

  async getInstruments(query?: InstrumentQuery): Promise<ExchangeInstrument[]> {
    const params: Record<string, string> = { instType: "SWAP" };
    if (query?.symbol) {
      params.instId = toOkxSymbol(query.symbol);
    }
    const values = z.array(instrumentSchema).parse(
      query?.environment
        ? await this.client.publicGet(
            "/api/v5/public/instruments",
            params,
            query.environment,
          )
        : await this.client.publicGet("/api/v5/public/instruments", params),
    );
    return values
      .flatMap((item) => {
        const symbol = this.tryOkxSwapSymbol(item.instId, "instruments");
        return symbol ? [this.instrument(item, symbol)] : [];
      })
      .filter((item) => !query?.status || item.status === query.status);
  }

  async getTicker(symbol: string): Promise<ExchangeTicker> {
    const instId = toOkxSymbol(symbol);
    const [ticker, mark] = await Promise.all([
      this.client
        .publicGet("/api/v5/market/ticker", { instId })
        .then((value) => z.array(tickerSchema).min(1).parse(value)[0]!),
      this.client
        .publicGet("/api/v5/public/mark-price", { instType: "SWAP", instId })
        .then((value) => z.array(markSchema).min(1).parse(value)[0]!),
    ]);
    const lastPrice = Number(ticker.last);
    const openPrice = Number(ticker.open24h);
    const priceChange = lastPrice - openPrice;
    const priceChangePercent = openPrice > 0
      ? (priceChange / openPrice) * 100
      : undefined;
    return {
      provider: this.provider,
      symbol: symbol.toUpperCase(),
      lastPrice: ticker.last,
      markPrice: mark.markPx,
      bidPrice: ticker.bidPx,
      askPrice: ticker.askPx,
      high24h: ticker.high24h,
      low24h: ticker.low24h,
      volume24h: ticker.vol24h,
      quoteVolume24h: ticker.volCcy24h,
      ...(Number.isFinite(priceChange)
        ? { priceChange24h: String(priceChange) }
        : {}),
      ...(priceChangePercent !== undefined && Number.isFinite(priceChangePercent)
        ? { priceChangePercent24h: String(priceChangePercent) }
        : {}),
      timestamp: new Date(Number(ticker.ts)),
    };
  }

  async getOrderBook(symbol: string, depth = 20): Promise<ExchangeOrderBook> {
    const value = z
      .array(bookSchema)
      .min(1)
      .parse(
        await this.client.publicGet("/api/v5/market/books", {
          instId: toOkxSymbol(symbol),
          sz: depth,
        }),
      )[0]!;
    return {
      provider: this.provider,
      symbol: symbol.toUpperCase(),
      bids: value.bids.map((level) => ({
        price: level[0]!,
        quantity: level[1]!,
      })),
      asks: value.asks.map((level) => ({
        price: level[0]!,
        quantity: level[1]!,
      })),
      timestamp: new Date(Number(value.ts)),
    };
  }

  async getRecentTrades(symbol: string, limit = 100): Promise<ExchangeTrade[]> {
    const values = z.array(tradeSchema).parse(
      await this.client.publicGet("/api/v5/market/trades", {
        instId: toOkxSymbol(symbol),
        limit,
      }),
    );
    return values.map((item) => ({
      provider: this.provider,
      symbol: symbol.toUpperCase(),
      tradeId: item.tradeId,
      price: item.px,
      quantity: item.sz,
      side: item.side === "sell" ? "SELL" : "BUY",
      timestamp: new Date(Number(item.ts)),
    }));
  }

  async getKlines(query: KlineQuery): Promise<ExchangeKline[]> {
    const values = z.array(candleSchema).parse(
      await this.client.publicGet("/api/v5/market/candles", {
        instId: toOkxSymbol(query.symbol),
        bar: toOkxInterval(query.interval),
        limit: query.limit,
        after: query.startTime?.getTime(),
        before: query.endTime?.getTime(),
      }),
    );
    return values
      .map((item) => ({
        provider: this.provider,
        symbol: query.symbol.toUpperCase(),
        interval: query.interval,
        openTime: new Date(Number(item[0])),
        closeTime: new Date(
          Number(item[0]) + this.intervalMilliseconds(query.interval) - 1,
        ),
        open: item[1] ?? "0",
        high: item[2] ?? "0",
        low: item[3] ?? "0",
        close: item[4] ?? "0",
        volume: item[5] ?? "0",
        quoteVolume: item[6] ?? item[5] ?? "0",
        isClosed: item[8] !== undefined ? item[8] === "1" : true,
      }))
      .reverse();
  }

  async getFundingRate(symbol: string): Promise<ExchangeFundingRate> {
    const value = z
      .array(fundingSchema)
      .min(1)
      .parse(
        await this.client.publicGet("/api/v5/public/funding-rate", {
          instId: toOkxSymbol(symbol),
        }),
      )[0]!;
    return {
      provider: this.provider,
      symbol: symbol.toUpperCase(),
      fundingRate: value.fundingRate,
      fundingTime: new Date(Number(value.fundingTime)),
      ...(value.nextFundingTime
        ? { nextFundingTime: new Date(Number(value.nextFundingTime)) }
        : {}),
    };
  }

  async getOpenInterest(symbol: string): Promise<ExchangeOpenInterest> {
    const value = z
      .array(interestSchema)
      .min(1)
      .parse(
        await this.client.publicGet("/api/v5/public/open-interest", {
          instType: "SWAP",
          instId: toOkxSymbol(symbol),
        }),
      )[0]!;
    return {
      provider: this.provider,
      symbol: symbol.toUpperCase(),
      openInterest: value.oi,
      ...(value.oiUsd ? { openInterestValue: value.oiUsd } : {}),
      timestamp: new Date(Number(value.ts)),
    };
  }

  async getAccountSummary(
    credentials: ExchangeCredentials,
  ): Promise<ExchangeAccountSummary> {
    const raw = await this.client.signedGet("/api/v5/account/balance", credentials);
    const parsed = z.array(accountSchema).parse(raw);
    const value = parsed[0] ?? { totalEq: "0", details: [], uTime: String(Date.now()) };
    const settlement =
      value.details.find((detail) => detail.ccy === "USDT") ?? value.details[0];
    const available = this.nonEmptyDecimal(
      settlement?.availBal,
      settlement?.availEq,
      value.availEq,
      settlement?.cashBal,
      settlement?.eq,
      value.totalEq,
      "0",
    );
    const upl = this.nonEmptyDecimal(value.upl, settlement?.upl, "0");
    const totalEquity = this.nonEmptyDecimal(value.totalEq, settlement?.eq, settlement?.cashBal, "0");
    return {
      provider: this.provider,
      totalEquity,
      availableBalance: available,
      totalUnrealizedPnl: upl,
      totalMarginBalance: totalEquity,
      canTrade: true,
      updatedAt: new Date(Number(value.uTime)),
    };
  }

  async getBalances(
    credentials: ExchangeCredentials,
  ): Promise<ExchangeBalance[]> {
    const raw = await this.client.signedGet("/api/v5/account/balance", credentials);
    const parsed = z.array(accountSchema).parse(raw);
    const value = parsed[0] ?? { totalEq: "0", details: [], uTime: String(Date.now()) };
    return value.details.map((item) => ({
      provider: this.provider,
      asset: item.ccy,
      total: this.nonEmptyDecimal(item.cashBal, item.eq, "0"),
      available: this.nonEmptyDecimal(item.availBal, item.availEq, item.cashBal, item.eq, "0"),
      ...(item.frozenBal ? { locked: item.frozenBal } : {}),
      ...(item.upl ? { unrealizedPnl: item.upl } : {}),
      ...(item.eq ? { marginBalance: item.eq } : {}),
    }));
  }

  async getPositions(
    credentials: ExchangeCredentials,
  ): Promise<ExchangePosition[]> {
    const [rawPositions, instruments] = await Promise.all([
      this.client.signedGet("/api/v5/account/positions", credentials, {
        instType: "SWAP",
      }),
      this.getInstruments({ environment: credentials.environment }),
    ]);
    const values = z.array(positionSchema).parse(rawPositions);
    return values
      .filter((item) => item.pos !== "0" && item.pos !== "0.0")
      .flatMap((item) => {
        const normalizedSymbol = this.tryOkxSwapSymbol(
          item.instId,
          "positions",
        );
        if (!normalizedSymbol) return [];
        const instrument = instruments.find(
          (candidate) => candidate.symbol === normalizedSymbol,
        );
        const quantity = this.baseQuantity(
          item.pos.startsWith("-") ? item.pos.slice(1) : item.pos,
          instrument?.contractSize,
        );
        const side: PositionSide =
          item.posSide === "long"
            ? "LONG"
            : item.posSide === "short"
              ? "SHORT"
              : item.pos.startsWith("-")
                ? "SHORT"
                : "LONG";
        return [{
          provider: this.provider,
          symbol: normalizedSymbol,
          side,
          positionMode: item.posSide === "net" ? "ONE_WAY" : "HEDGE",
          quantity,
          entryPrice: item.avgPx,
          ...(item.markPx ? { markPrice: item.markPx } : {}),
          ...(item.liqPx ? { liquidationPrice: item.liqPx } : {}),
          ...(item.lever ? { leverage: item.lever } : {}),
          ...(item.mgnMode
            ? { marginType: item.mgnMode === "isolated" ? "ISOLATED" : "CROSS" }
            : {}),
          ...(item.margin ? { margin: item.margin } : {}),
          unrealizedPnl: item.upl,
          ...(item.realizedPnl ? { realizedPnl: item.realizedPnl } : {}),
          ...(item.notionalUsd ? { notional: item.notionalUsd } : {}),
          updatedAt: new Date(Number(item.uTime)),
        }];
      });
  }

  async getOpenOrders(
    credentials: ExchangeCredentials,
    query?: OpenOrderQuery,
  ): Promise<ExchangeOrder[]> {
    const values = z.array(orderSchema).parse(
      await this.client.signedGet("/api/v5/trade/orders-pending", credentials, {
        instType: "SWAP",
        instId: query?.symbol ? toOkxSymbol(query.symbol) : undefined,
      }),
    );
    const instruments = await this.getInstruments({
      environment: credentials.environment,
    }).catch(() => []);
    return values.flatMap((item) =>
      this.safeOrder(item, "open_orders", instruments)
    );
  }

  async getOrderHistory(
    credentials: ExchangeCredentials,
    _symbols?: string[],
    limit = 20,
  ): Promise<ExchangeOrder[]> {
    const historyLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const values = z.array(orderSchema).parse(
      await this.client.signedGet("/api/v5/trade/orders-history", credentials, {
        instType: "SWAP",
        limit: historyLimit,
      }),
    );
    const instruments = await this.getInstruments({
      environment: credentials.environment,
    }).catch(() => []);
    return values
      .flatMap((item) =>
        this.safeOrder(item, "order_history", instruments)
      )
      .slice(0, historyLimit);
  }

  async getTradeFills(
    credentials: ExchangeCredentials,
    symbols?: string[],
    limit = 100,
    before?: Date,
  ): Promise<ExchangeFill[]> {
    const historyLimit = Math.min(1000, Math.max(1, Math.trunc(limit)));
    const pageSize = Math.min(100, historyLimit);
    const seenTradeKeys = new Set<string>();
    const values: Array<z.infer<typeof fillSchema>> = [];

    // 1. Fetch recent fills (last 3 days) first
    try {
      const recentFills = z.array(fillSchema).parse(
        await this.client.signedGet("/api/v5/trade/fills", credentials, {
          instType: "SWAP",
          limit: pageSize,
          ...(before ? { end: before.getTime() } : {}),
        }),
      );
      for (const fill of recentFills) {
        const key = fill.tradeId || fill.billId || `${fill.ordId}:${fill.fillTime ?? fill.ts}`;
        if (!seenTradeKeys.has(key)) {
          seenTradeKeys.add(key);
          values.push(fill);
        }
      }
    } catch (error) {
      this.logger.warn({
        event: "okx_recent_fills_fetch_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 2. Fetch older history if needed
    if (values.length < historyLimit) {
      try {
        let after: string | undefined;
        while (values.length < historyLimit) {
          const page = z.array(fillSchema).parse(
            await this.client.signedGet(
              "/api/v5/trade/fills-history",
              credentials,
              {
                instType: "SWAP",
                limit: Math.min(pageSize, historyLimit - values.length),
                after,
                ...(before ? { end: before.getTime() } : {}),
              },
            ),
          );
          if (!page.length) break;
          for (const fill of page) {
            const key = fill.tradeId || fill.billId || `${fill.ordId}:${fill.fillTime ?? fill.ts}`;
            if (!seenTradeKeys.has(key)) {
              seenTradeKeys.add(key);
              values.push(fill);
            }
          }
          const next = page.at(-1)?.billId;
          if (page.length < pageSize || !next || next === after) break;
          after = next;
        }
      } catch (error) {
        this.logger.warn({
          event: "okx_fills_history_fetch_failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const instruments = await this.getInstruments({
      environment: credentials.environment,
    });
    const normalizedSymbols = symbols?.length ? new Set(symbols.map((symbol) => symbol.toUpperCase())) : null;
    return values.flatMap((item) => {
      const symbol = this.tryOkxSwapSymbol(item.instId, "trade_fills");
      if (!symbol) return [];
      const instrument = instruments.find((candidate) => candidate.symbol === symbol);
      const quantity = this.baseQuantity(item.fillSz, instrument?.contractSize);
      const realizedPnl = Number(item.fillPnl);
      const positionSide = item.posSide ? this.positionSide(item.posSide) : undefined;
      const isClosing =
        realizedPnl !== 0 ||
        (positionSide === "LONG" && item.side === "sell") ||
        (positionSide === "SHORT" && item.side === "buy");
      return [{
        provider: this.provider,
        symbol,
        exchangeTradeId: item.tradeId,
        exchangeOrderId: item.ordId,
        ...(item.clOrdId ? { clientOrderId: item.clOrdId } : {}),
        side: item.side === "sell" ? "SELL" as const : "BUY" as const,
        ...(positionSide ? { positionSide } : {}),
        price: item.fillPx,
        quantity,
        quoteQuantity: String(Number(quantity) * Number(item.fillPx)),
        realizedPnl: item.fillPnl,
        fee: item.fee,
        ...(item.feeCcy ? { feeAsset: item.feeCcy } : {}),
        ...(item.execType ? { isMaker: item.execType === "M" } : {}),
        isClosing,
        executedAt: new Date(Number(item.fillTime ?? item.ts)),
      }];
    }).filter((fill) => !normalizedSymbols || normalizedSymbols.has(fill.symbol));
  }

  async getOrder(
    credentials: ExchangeCredentials,
    query: GetOrderQuery,
  ): Promise<ExchangeOrder> {
    const value = z
      .array(orderSchema)
      .min(1)
      .parse(
        await this.client.signedGet("/api/v5/trade/order", credentials, {
          instId: toOkxSymbol(query.symbol),
          ordId: query.orderId,
          clOrdId: query.clientOrderId,
        }),
      )[0]!;
    return this.order(value);
  }

  async getAccountConfiguration(
    credentials: ExchangeCredentials,
  ): Promise<ExchangeAccountConfiguration> {
    const value = z
      .array(configSchema)
      .min(1)
      .parse(
        await this.client.signedGet("/api/v5/account/config", credentials),
      )[0]!;
    return {
      provider: this.provider,
      positionMode: value.posMode === "long_short_mode" ? "HEDGE" : "ONE_WAY",
      ...(value.acctLv ? { accountMode: value.acctLv } : {}),
      canTrade: true,
    };
  }

  async placeOrder(
    credentials: ExchangeCredentials,
    command: PlaceOrderCommand,
  ): Promise<ExchangeOrder> {
    const normalizedSymbol = mapSymbol(command.symbol, this.provider);
    const instId = normalizedSymbol;
    const searchSymbol = command.symbol.toUpperCase().replace("/", "-");
    const instruments = await this.getInstruments({
      symbol: command.symbol,
      environment: credentials.environment,
    });
    const instrument = instruments.find(
      (candidate) =>
        candidate.symbol === searchSymbol ||
        candidate.symbol === command.symbol ||
        mapSymbol(candidate.symbol, this.provider) === instId,
    ) ?? instruments[0];
    if (!instrument?.contractSize) {
      throw ExchangeError.invalidRequest(
        this.provider,
        "OKX contract metadata is unavailable for this symbol",
      );
    }
    const sanitizedPosSide = command.positionSide
      ? command.positionSide.toLowerCase() === "both"
        ? undefined
        : (command.positionSide.toLowerCase() as "long" | "short" | "net")
      : undefined;

    if (!command.reduceOnly) {
      try {
        await this.client.signedPost("/api/v5/account/set-leverage", credentials, {
          instId,
          lever: String(command.leverage),
          mgnMode: "cross",
          ...(sanitizedPosSide ? { posSide: sanitizedPosSide } : {}),
        });
      } catch (error) {
        this.logger.error({
          event: "okx_leverage_setup_failed",
          exchange: this.provider,
          symbol: command.symbol,
          requestedLeverage: command.leverage,
          error: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof ExchangeError) throw error;
        throw new ExchangeError(
          ExchangeErrorCode.UNKNOWN,
          this.provider,
          true,
          503,
          `OKX leverage setup failed for ${instId}`,
        );
      }
    }
    const accountMaximumContracts = command.reduceOnly
      ? undefined
      : await this.maximumOrderContracts(
        credentials,
        instId,
        command.side,
      );
    const requestedContracts = Number(command.quantity) / Number(instrument.contractSize);
    const contractQuantity = this.contractQuantity(
      command.quantity,
      instrument.contractSize,
      instrument.stepSize,
      instrument.quantityPrecision,
      instrument.minQuantity,
      instrument.maxQuantity,
      accountMaximumContracts,
    );
    const submittedContracts = Number(contractQuantity);
    if (submittedContracts < requestedContracts) {
      this.logger.warn({
        event: "okx_order_size_capped",
        exchange: this.provider,
        symbol: command.symbol,
        requestedContracts,
        instrumentMaximumContracts: instrument.maxQuantity,
        accountMaximumContracts,
        submittedContracts,
        contractLot: instrument.stepSize,
        leverage: command.leverage,
      });
    }
    const submittedBaseQuantity = this.decimalString(
      Number(contractQuantity) * Number(instrument.contractSize),
      12,
    );
    let clOrdId = normalizeClientOrderId(command.clientOrderId) ?? "";
    let protectiveClientOrderId = (command.stopLoss || command.takeProfit)
      ? normalizeClientOrderId(`${clOrdId.slice(0, 28)}pm`)
      : undefined;
    let marketPrice: string | undefined = undefined;
    const makerFirst =
      !command.reduceOnly &&
      (this.config?.get<boolean>("OKX_MAKER_FIRST_ENABLED") ?? false);
    let ordType: "limit" | "market" | "post_only" = command.reduceOnly
      ? "market"
      : "limit";
    if (!command.reduceOnly) {
      try {
        const ticker = await this.bestBidAsk(command.symbol);
        this.assertEntryPriceDrift(command, ticker.askPrice, ticker.bidPrice);
        const selectedPrice = makerFirst
          ? command.side.toUpperCase() === "BUY"
            ? ticker.bidPrice
            : ticker.askPrice
          : command.side.toUpperCase() === "BUY"
            ? ticker.askPrice
            : ticker.bidPrice;
        const numericPrice = Number(selectedPrice);
        if (Number.isFinite(numericPrice) && numericPrice > 0) {
          marketPrice = selectedPrice;
          ordType = makerFirst ? "post_only" : "limit";
        }
      } catch (error) {
        if (
          error instanceof ExchangeError &&
          error.exchangeCode === "ENTRY_PRICE_DRIFT"
        ) throw error;
        if (
          Number.isFinite(Number(command.referencePrice)) &&
          Number(command.referencePrice) > 0 &&
          Number.isFinite(Number(command.maxAdverseDriftBps))
        ) {
          if (error instanceof ExchangeError) throw error;
          throw new ExchangeError(
            ExchangeErrorCode.UNAVAILABLE,
            this.provider,
            true,
            503,
            "Entry price preflight is unavailable",
          );
        }
        this.logger.warn({
          event: "okx_order_price_lookup_failed",
          exchange: this.provider,
          symbol: command.symbol,
          error: error instanceof Error ? error.message : String(error),
        });
        if (makerFirst) ordType = "market";
      }
    }
    const body: Record<string, unknown> = {
      instId,
      tdMode: "cross",
      side: command.side.toLowerCase(),
      ordType,
      ...(ordType !== "market" && marketPrice ? { px: marketPrice } : {}),
      sz: contractQuantity,
      ...(clOrdId ? { clOrdId } : {}),
      ...(command.reduceOnly ? { reduceOnly: true } : {}),
      ...(sanitizedPosSide ? { posSide: sanitizedPosSide } : {}),
    };
    const numericStopLoss = Number(command.stopLoss);
    const numericTakeProfit = Number(command.takeProfit);
    const hasSl = Number.isFinite(numericStopLoss) && numericStopLoss > 0;
    const hasTp = Number.isFinite(numericTakeProfit) && numericTakeProfit > 0;
    const formattedSl = hasSl
      ? this.decimalString(numericStopLoss, instrument.pricePrecision)
      : undefined;
    const formattedTp = hasTp
      ? this.decimalString(numericTakeProfit, instrument.pricePrecision)
      : undefined;

    if (formattedSl || formattedTp) {
      body.attachAlgoOrds = [
        {
          ...(protectiveClientOrderId
            ? { attachAlgoClOrdId: protectiveClientOrderId }
            : {}),
          ...(formattedSl
            ? {
                slTriggerPx: formattedSl,
                slOrdPx: "-1",
                slTriggerPxType: "mark",
              }
            : {}),
          ...(formattedTp
            ? {
                tpTriggerPx: formattedTp,
                tpOrdPx: "-1",
                tpTriggerPxType: "mark",
              }
            : {}),
        },
      ];
    }
    this.logger.warn({
      event: "okx_order_request",
      exchange: this.provider,
      originalSymbol: command.symbol,
      normalizedSymbol,
      instId,
      requestedQuantity: command.quantity,
      contractQuantity,
      leverage: command.leverage,
      marketPrice,
      body,
    });
    const placeOrderAttempt = async (
      requestBody: Record<string, unknown>,
    ): Promise<unknown> => {
      try {
        return await this.client.signedPost(
          "/api/v5/trade/order",
          credentials,
          requestBody,
        );
      } catch (error) {
        const exchangeError =
          error instanceof ExchangeError
            ? error
            : new ExchangeError(
                ExchangeErrorCode.UNKNOWN,
                this.provider,
                false,
                502,
                error instanceof Error ? error.message : "OKX rejected the order",
              );
        this.logger.error({
          event: "exchange_order_rejected",
          exchange: this.provider,
          originalSymbol: command.symbol,
          normalizedSymbol,
          instId,
          requestBody,
          responseCode: exchangeError.exchangeCode,
          reason: exchangeError.message,
        });
        throw exchangeError;
      }
    };

    let submittedOrderType = body.ordType as "limit" | "market" | "post_only";
    let ackPayload: unknown;
    try {
      ackPayload = await placeOrderAttempt(body);
    } catch (error) {
      if (
        body.ordType === "limit" &&
        this.shouldRetryAsMarketOrder(error, body)
      ) {
        const fallbackBody = {
          ...body,
          ordType: "market",
        } as Record<string, unknown>;
        delete fallbackBody.px;
        this.logger.warn({
          event: "okx_order_retrying_as_market",
          exchange: this.provider,
          originalSymbol: command.symbol,
          normalizedSymbol,
          instId,
          reason:
            error instanceof Error
              ? error.message
              : "OKX rejected the order",
          fallbackBody,
        });
        ackPayload = await placeOrderAttempt(fallbackBody);
        submittedOrderType = "market";
      } else {
        throw error;
      }
    }
    let ack = z.array(orderAckSchema).min(1).parse(ackPayload)[0]!;
    if (ack.sCode !== "0") {
      if (
        body.ordType === "limit" &&
        this.shouldRetryAsMarketOrder(ack, body)
      ) {
        const fallbackBody = {
          ...body,
          ordType: "market",
        } as Record<string, unknown>;
        delete fallbackBody.px;
        this.logger.warn({
          event: "okx_order_retrying_as_market",
          exchange: this.provider,
          originalSymbol: command.symbol,
          normalizedSymbol,
          instId,
          reason: ack.sMsg,
          fallbackBody,
        });
        ackPayload = await placeOrderAttempt(fallbackBody);
        ack = z.array(orderAckSchema).min(1).parse(ackPayload)[0]!;
        submittedOrderType = "market";
      }
      if (ack.sCode !== "0") {
        this.logger.warn({
          event: "exchange_order_rejected",
          exchange: this.provider,
          originalSymbol: command.symbol,
          normalizedSymbol,
          instId,
          requestBody: body,
          response: ack,
        });
        throw new ExchangeError(
          ExchangeErrorCode.INVALID_REQUEST,
          this.provider,
          false,
          400,
          ack.sMsg || "OKX rejected the order",
          ack.sCode,
        );
      }
    }

    if (submittedOrderType === "post_only") {
      const makerOrder = await this.awaitMakerFirstResult(
        credentials,
        command.symbol,
        ack.ordId,
      );
      const executedContracts = Number(makerOrder.executedQuantity);
      if (makerOrder.status === "FILLED" || executedContracts > 0) {
        const executedQuantity = this.decimalString(
          executedContracts * Number(instrument.contractSize),
          12,
        );
        const status = makerOrder.status === "FILLED"
          ? "FILLED"
          : "PARTIALLY_FILLED";
        return {
          ...makerOrder,
          symbol: command.symbol,
          clientOrderId: ack.clOrdId ?? command.clientOrderId,
          type: "LIMIT",
          timeInForce: "POST_ONLY",
          status,
          originalQuantity: submittedBaseQuantity,
          executedQuantity,
          reduceOnly: command.reduceOnly ?? false,
          ...(command.positionSide ? { positionSide: command.positionSide } : {}),
          ...(protectiveClientOrderId ? { protectiveClientOrderId } : {}),
        };
      }
      this.logger.warn({
        event: "okx_maker_first_unfilled_canceling",
        exchange: this.provider,
        symbol: command.symbol,
        orderId: ack.ordId,
      });
      await this.cancelOrder(credentials, {
        symbol: command.symbol,
        orderId: ack.ordId,
      }).catch((error) => {
        this.logger.warn({
          event: "okx_maker_first_cancel_failed",
          exchange: this.provider,
          symbol: command.symbol,
          orderId: ack.ordId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      clOrdId = normalizeClientOrderId(`${clOrdId.slice(0, 28)}fb`) ?? clOrdId;
      protectiveClientOrderId = (command.stopLoss || command.takeProfit)
        ? normalizeClientOrderId(`${clOrdId.slice(0, 28)}pm`)
        : undefined;
      const fallbackBody = {
        ...body,
        ordType: "market",
        ...(clOrdId ? { clOrdId } : {}),
      } as Record<string, unknown>;
      delete fallbackBody.px;
      if (Array.isArray(fallbackBody.attachAlgoOrds)) {
        fallbackBody.attachAlgoOrds = fallbackBody.attachAlgoOrds.map((algo) => ({
          ...(algo as Record<string, unknown>),
          ...(protectiveClientOrderId
            ? { attachAlgoClOrdId: protectiveClientOrderId }
            : {}),
        }));
      }
      ackPayload = await placeOrderAttempt(fallbackBody);
      ack = z.array(orderAckSchema).min(1).parse(ackPayload)[0]!;
      if (ack.sCode !== "0") {
        throw new ExchangeError(
          ExchangeErrorCode.INVALID_REQUEST,
          this.provider,
          false,
          400,
          ack.sMsg || "OKX rejected the maker fallback order",
          ack.sCode,
        );
      }
      submittedOrderType = "market";
    }
    return {
      provider: this.provider,
      symbol: command.symbol,
      exchangeOrderId: ack.ordId,
      clientOrderId: ack.clOrdId ?? clOrdId ?? command.clientOrderId,
      side: command.side,
      type: submittedOrderType === "market" ? "MARKET" : "LIMIT",
      status: "NEW",
      originalQuantity: submittedBaseQuantity,
      executedQuantity: "0",
      reduceOnly: command.reduceOnly ?? false,
      ...(command.positionSide ? { positionSide: command.positionSide } : {}),
      ...(protectiveClientOrderId ? { protectiveClientOrderId } : {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private assertEntryPriceDrift(
    command: PlaceOrderCommand,
    askPrice: string,
    bidPrice: string,
  ): void {
    const referencePrice = Number(command.referencePrice);
    const maximumBps = Number(command.maxAdverseDriftBps);
    if (
      !Number.isFinite(referencePrice) ||
      referencePrice <= 0 ||
      !Number.isFinite(maximumBps) ||
      maximumBps < 0
    ) return;
    const executablePrice = Number(command.side === "BUY" ? askPrice : bidPrice);
    if (!Number.isFinite(executablePrice) || executablePrice <= 0) return;
    const adverseBps = command.side === "BUY"
      ? ((executablePrice - referencePrice) / referencePrice) * 10_000
      : ((referencePrice - executablePrice) / referencePrice) * 10_000;
    if (adverseBps <= maximumBps + 1e-8) return;
    throw new ExchangeError(
      ExchangeErrorCode.INVALID_REQUEST,
      this.provider,
      false,
      400,
      `Entry price drift ${adverseBps.toFixed(2)}bps exceeds ${maximumBps.toFixed(2)}bps limit`,
      "ENTRY_PRICE_DRIFT",
    );
  }

  private async maximumOrderContracts(
    credentials: ExchangeCredentials,
    instId: string,
    side: "BUY" | "SELL",
  ): Promise<number> {
    try {
      const values = z.array(maximumOrderSizeSchema).parse(
        await this.client.signedGet(
          "/api/v5/account/max-size",
          credentials,
          { instId, tdMode: "cross" },
        ),
      );
      const value = side === "BUY" ? values[0]?.maxBuy : values[0]?.maxSell;
      const maximum = Number(value);
      if (!Number.isFinite(maximum) || maximum < 0) {
        throw new Error(`Invalid maximum order size: ${String(value)}`);
      }
      return maximum;
    } catch (error) {
      this.logger.error({
        event: "okx_max_order_size_lookup_failed",
        exchange: this.provider,
        instId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ExchangeError(
        ExchangeErrorCode.UNAVAILABLE,
        this.provider,
        true,
        503,
        `OKX maximum order size preflight is unavailable for ${instId}`,
      );
    }
  }

  async amendProtectiveOrder(
    credentials: ExchangeCredentials,
    command: AmendProtectiveOrderCommand,
  ): Promise<void> {
    const numericStop = Number(command.stopLoss);
    const numericTake = Number(command.takeProfit);
    const hasStop = Number.isFinite(numericStop) && numericStop > 0;
    const hasTake = Number.isFinite(numericTake) && numericTake > 0;
    if (!hasStop && !hasTake) {
      throw ExchangeError.invalidRequest(this.provider, "A protective price is required");
    }
    const instruments = await this.getInstruments({
      symbol: command.symbol,
      environment: credentials.environment,
    });
    const instrument = instruments.find(
      (c) => c.symbol === command.symbol || mapSymbol(c.symbol, this.provider) === toOkxSymbol(command.symbol),
    );
    const precision = instrument?.pricePrecision ?? 2;
    const response = z.array(algoAckSchema).min(1).parse(
      await this.client.signedPost("/api/v5/trade/amend-algos", credentials, {
        instId: toOkxSymbol(command.symbol),
        algoClOrdId: normalizeClientOrderId(command.protectiveClientOrderId),
        reqId: normalizeClientOrderId(command.requestId),
        cxlOnFail: false,
        ...(hasStop ? { newSlTriggerPx: this.decimalString(numericStop, precision), newSlOrdPx: "-1", newSlTriggerPxType: "mark" } : {}),
        ...(hasTake ? { newTpTriggerPx: this.decimalString(numericTake, precision), newTpOrdPx: "-1", newTpTriggerPxType: "mark" } : {}),
      }),
    )[0]!;
    if (response.sCode !== "0") {
      throw new ExchangeError(
        ExchangeErrorCode.INVALID_REQUEST,
        this.provider,
        false,
        400,
        response.sMsg || "OKX rejected protective order amendment",
        response.sCode,
      );
    }
  }

  async getProtectiveOrderStatus(
    credentials: ExchangeCredentials,
    command: CancelProtectiveOrderCommand,
  ): Promise<ProtectiveOrderStatus> {
    try {
      const values = z.array(algoOrderDetailSchema).parse(
        await this.client.signedGet("/api/v5/trade/order-algo", credentials, {
          algoClOrdId: normalizeClientOrderId(
            command.protectiveClientOrderId,
          ),
        }),
      );
      const order = values[0];
      if (!order) return "MISSING";
      if (["live", "partially_filled"].includes(order.state)) return "ACTIVE";
      if (["effective", "partially_effective"].includes(order.state)) {
        return "TERMINAL";
      }
      return "MISSING";
    } catch (error) {
      if (error instanceof ExchangeError && error.exchangeCode === "51603") {
        return "MISSING";
      }
      throw error;
    }
  }

  async placeProtectiveOrder(
    credentials: ExchangeCredentials,
    command: PlaceProtectiveOrderCommand,
  ): Promise<void> {
    const numericStop = Number(command.stopLoss);
    const numericTake = Number(command.takeProfit);
    const hasStop = Number.isFinite(numericStop) && numericStop > 0;
    const hasTake = Number.isFinite(numericTake) && numericTake > 0;
    if (!hasStop && !hasTake) {
      throw ExchangeError.invalidRequest(
        this.provider,
        "A protective price is required",
      );
    }
    const instruments = await this.getInstruments({
      symbol: command.symbol,
      environment: credentials.environment,
    });
    const instrument = instruments.find(
      (candidate) =>
        candidate.symbol === command.symbol ||
        mapSymbol(candidate.symbol, this.provider) ===
          toOkxSymbol(command.symbol),
    );
    const precision = instrument?.pricePrecision ?? 2;
    const response = z.array(algoAckSchema).min(1).parse(
      await this.client.signedPost("/api/v5/trade/order-algo", credentials, {
        instId: toOkxSymbol(command.symbol),
        tdMode: "cross",
        side: command.positionSide === "LONG" ? "sell" : "buy",
        posSide:
          command.positionMode === "HEDGE"
            ? command.positionSide.toLowerCase()
            : "net",
        ordType: hasStop && hasTake ? "oco" : "conditional",
        closeFraction: "1",
        algoClOrdId: normalizeClientOrderId(
          command.protectiveClientOrderId,
        ),
        ...(command.positionMode === "ONE_WAY" ? { reduceOnly: true } : {}),
        ...(hasStop
          ? {
              slTriggerPx: this.decimalString(numericStop, precision),
              slOrdPx: "-1",
              slTriggerPxType: "mark",
            }
          : {}),
        ...(hasTake
          ? {
              tpTriggerPx: this.decimalString(numericTake, precision),
              tpOrdPx: "-1",
              tpTriggerPxType: "mark",
            }
          : {}),
      }),
    )[0]!;
    if (response.sCode !== "0") {
      throw new ExchangeError(
        ExchangeErrorCode.INVALID_REQUEST,
        this.provider,
        false,
        400,
        response.sMsg || "OKX rejected protective order recovery",
        response.sCode,
      );
    }
  }

  async cancelProtectiveOrder(
    credentials: ExchangeCredentials,
    command: CancelProtectiveOrderCommand,
  ): Promise<void> {
    const response = z.array(algoAckSchema).min(1).parse(
      await this.client.signedPost("/api/v5/trade/cancel-algos", credentials, [{
        instId: toOkxSymbol(command.symbol),
        algoClOrdId: normalizeClientOrderId(command.protectiveClientOrderId),
      }]),
    )[0]!;
    if (response.sCode !== "0") {
      throw new ExchangeError(
        ExchangeErrorCode.INVALID_REQUEST,
        this.provider,
        false,
        400,
        response.sMsg || "OKX rejected protective order cancellation",
        response.sCode,
      );
    }
  }

  async cancelOrder(
    credentials: ExchangeCredentials,
    command: CancelOrderCommand,
  ): Promise<ExchangeOrder> {
    const ack = z
      .array(orderAckSchema)
      .min(1)
      .parse(
        await this.client.signedPost(
          "/api/v5/trade/cancel-order",
          credentials,
          {
            instId: toOkxSymbol(command.symbol),
            ...(command.orderId ? { ordId: command.orderId } : {}),
            ...(normalizeClientOrderId(command.clientOrderId)
              ? { clOrdId: normalizeClientOrderId(command.clientOrderId) }
              : {}),
          },
        ),
      )[0]!;
    if (ack.sCode !== "0") {
      throw new ExchangeError(
        ExchangeErrorCode.INVALID_REQUEST,
        this.provider,
        false,
        400,
        ack.sMsg || "OKX rejected cancellation",
        ack.sCode,
      );
    }
    return {
      provider: this.provider,
      symbol: command.symbol,
      exchangeOrderId: ack.ordId,
      clientOrderId: ack.clOrdId,
      side: "BUY",
      type: "UNKNOWN",
      status: "CANCELED",
      originalQuantity: "0",
      executedQuantity: "0",
      updatedAt: new Date(),
    };
  }

  private async awaitMakerFirstResult(
    credentials: ExchangeCredentials,
    symbol: string,
    orderId: string,
  ): Promise<ExchangeOrder> {
    const timeoutMs =
      this.config?.get<number>("OKX_MAKER_FIRST_TIMEOUT_MS") ?? 2_500;
    const pollIntervalMs =
      this.config?.get<number>("OKX_MAKER_FIRST_POLL_INTERVAL_MS") ?? 250;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const order = await this.getOrder(credentials, { symbol, orderId });
        if (order.status === "FILLED" || order.status === "CANCELED") {
          return order;
        }
      } catch (error) {
        this.logger.warn({
          event: "okx_maker_entry_status_check_failed",
          exchange: this.provider,
          symbol,
          exchangeOrderId: orderId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await this.delay(pollIntervalMs);
    }

    try {
      await this.cancelOrder(credentials, { symbol, orderId });
    } catch (error) {
      // A fill can win the race with cancellation. The final GET below is the
      // source of truth and prevents a second order from being submitted while
      // the maker order may still be active.
      this.logger.warn({
        event: "okx_maker_entry_cancel_ack_failed",
        exchange: this.provider,
        symbol,
        exchangeOrderId: orderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const confirmationDeadline = Date.now() + Math.max(1_000, pollIntervalMs * 4);
    let lastOrder: ExchangeOrder | undefined;
    while (Date.now() < confirmationDeadline) {
      try {
        lastOrder = await this.getOrder(credentials, { symbol, orderId });
        if (lastOrder.status === "FILLED" || lastOrder.status === "CANCELED") {
          return lastOrder;
        }
      } catch (error) {
        this.logger.warn({
          event: "okx_maker_entry_cancel_confirmation_failed",
          exchange: this.provider,
          symbol,
          exchangeOrderId: orderId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await this.delay(pollIntervalMs);
    }

    throw new ExchangeError(
      ExchangeErrorCode.UNKNOWN,
      this.provider,
      true,
      503,
      `OKX maker order cancellation was not confirmed (last status: ${lastOrder?.status ?? "unavailable"})`,
    );
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private async bestBidAsk(symbol: string): Promise<{
    bidPrice: string;
    askPrice: string;
  }> {
    const ticker = z.array(tickerSchema).min(1).parse(
      await this.client.publicGet("/api/v5/market/ticker", {
        instId: toOkxSymbol(symbol),
      }),
    )[0]!;
    return { bidPrice: ticker.bidPx, askPrice: ticker.askPx };
  }

  private instrument(
    item: z.infer<typeof instrumentSchema>,
    normalizedSymbol = fromOkxSymbol(item.instId),
  ): ExchangeInstrument {
    const [base = "", quote = ""] = item.instId.split("-");
    const precision = (value: string): number =>
      value.includes(".")
        ? (value.replace(/0+$/, "").split(".")[1]?.length ?? 0)
        : 0;
    const maxQuantity = item.maxMktSz ?? item.maxLmtSz;
    return {
      provider: this.provider,
      symbol: normalizedSymbol,
      baseAsset: base,
      quoteAsset: quote,
      settlementAsset: item.settleCcy,
      instrumentType: item.instType === "SWAP" ? "PERPETUAL" : "FUTURE",
      status:
        item.state === "live"
          ? "TRADING"
          : item.state === "preopen"
            ? "PRE_TRADING"
            : "SUSPENDED",
      pricePrecision: precision(item.tickSz),
      quantityPrecision: precision(item.lotSz),
      tickSize: item.tickSz,
      stepSize: item.lotSz,
      minQuantity: item.minSz,
      ...(maxQuantity ? { maxQuantity } : {}),
      ...(item.ctVal ? { contractSize: item.ctVal } : {}),
      supportsMarketOrder: true,
      supportsLimitOrder: true,
      supportsStopOrder: true,
    };
  }

  private nonEmptyDecimal(...values: Array<string | undefined>): string {
    return (
      values.find((value) => value !== undefined && value.trim() !== "") ?? "0"
    );
  }

  private baseQuantity(contracts: string, contractSize?: string): string {
    if (!contractSize) return contracts;
    const value = Number(contracts) * Number(contractSize);
    if (!Number.isFinite(value) || value <= 0) return contracts;
    return this.decimalString(value, 12);
  }

  private contractQuantity(
    baseQuantity: string,
    contractSize: string,
    lotSize: string,
    precision: number,
    minQuantity?: string,
    maxQuantity?: string,
    accountMaximumQuantity?: number,
  ): string {
    const raw = Number(baseQuantity) / Number(contractSize);
    const lot = Number(lotSize);
    if (
      !Number.isFinite(raw) ||
      !Number.isFinite(lot) ||
      raw <= 0 ||
      lot <= 0
    ) {
      throw ExchangeError.invalidRequest(
        this.provider,
        "Invalid OKX order quantity",
      );
    }
    const caps = [raw];
    const instrumentMaximum = Number(maxQuantity);
    if (Number.isFinite(instrumentMaximum) && instrumentMaximum >= 0) {
      caps.push(instrumentMaximum);
    }
    if (
      accountMaximumQuantity !== undefined &&
      Number.isFinite(accountMaximumQuantity) &&
      accountMaximumQuantity >= 0
    ) {
      caps.push(accountMaximumQuantity);
    }
    const cappedRaw = Math.min(...caps);
    const lotCount = Math.floor((cappedRaw + Number.EPSILON) / lot);
    const contractCount = lotCount * lot;
    const minimum = Number(minQuantity);
    if (
      !Number.isFinite(contractCount) ||
      contractCount <= 0 ||
      (Number.isFinite(minimum) && contractCount < minimum)
    ) {
      throw ExchangeError.invalidRequest(
        this.provider,
        `Order size is below the OKX minimum (${minQuantity ?? lotSize} contracts)`,
      );
    }
    return this.decimalString(contractCount, precision);
  }

  private decimalString(value: number, precision: number): string {
    const fixed = value.toFixed(Math.min(precision, 12));
    return fixed.includes(".")
      ? fixed.replace(/0+$/, "").replace(/\.$/, "")
      : fixed;
  }

  private shouldRetryAsMarketOrder(
    ackOrError: unknown,
    body: Record<string, unknown>,
  ): boolean {
    if (body.ordType !== "limit") return false;
    if (ackOrError instanceof ExchangeError) {
      const message = (ackOrError.message ?? "").toLowerCase();
      return (
        ackOrError.exchangeCode === "1" ||
        message.includes("all operations failed")
      );
    }
    if (!ackOrError || typeof ackOrError !== "object") return false;
    const ack = ackOrError as Partial<z.infer<typeof orderAckSchema>>;
    if (ack.sCode === "1") return true;
    const message = (ack.sMsg ?? "").toLowerCase();
    return message.includes("all operations failed");
  }

  private intervalMilliseconds(interval: ExchangeInterval): number {
    const values: Record<ExchangeInterval, number> = {
      [ExchangeInterval.ONE_MINUTE]: 60_000,
      [ExchangeInterval.THREE_MINUTES]: 180_000,
      [ExchangeInterval.FIVE_MINUTES]: 300_000,
      [ExchangeInterval.FIFTEEN_MINUTES]: 900_000,
      [ExchangeInterval.THIRTY_MINUTES]: 1_800_000,
      [ExchangeInterval.ONE_HOUR]: 3_600_000,
      [ExchangeInterval.TWO_HOURS]: 7_200_000,
      [ExchangeInterval.FOUR_HOURS]: 14_400_000,
      [ExchangeInterval.SIX_HOURS]: 21_600_000,
      [ExchangeInterval.EIGHT_HOURS]: 28_800_000,
      [ExchangeInterval.TWELVE_HOURS]: 43_200_000,
      [ExchangeInterval.ONE_DAY]: 86_400_000,
      [ExchangeInterval.ONE_WEEK]: 604_800_000,
      [ExchangeInterval.ONE_MONTH]: 2_592_000_000,
    };
    return values[interval] ?? 60_000;
  }

  private order(
    item: z.infer<typeof orderSchema>,
    normalizedSymbol = fromOkxSymbol(item.instId),
    contractSize?: string,
  ): ExchangeOrder {
    return {
      provider: this.provider,
      symbol: normalizedSymbol,
      exchangeOrderId: item.ordId,
      ...(item.clOrdId ? { clientOrderId: item.clOrdId } : {}),
      side: item.side === "sell" ? "SELL" : "BUY",
      type: this.orderType(item.ordType),
      status: this.orderStatus(item.state),
      ...(item.ordType === "post_only" ? { timeInForce: "POST_ONLY" } : {}),
      ...(item.px ? { price: item.px } : {}),
      ...(item.triggerPx ? { stopPrice: item.triggerPx } : {}),
      ...(item.avgPx ? { averagePrice: item.avgPx } : {}),
      originalQuantity: this.baseQuantity(item.sz, contractSize),
      executedQuantity: this.baseQuantity(item.accFillSz, contractSize),
      ...(item.reduceOnly === undefined
        ? {}
        : {
            reduceOnly: item.reduceOnly === true || item.reduceOnly === "true",
          }),
      ...(item.posSide
        ? { positionSide: this.positionSide(item.posSide) }
        : {}),
      ...(item.source ? { sourceCode: item.source } : {}),
      ...(item.algoClOrdId ? { algoClientOrderId: item.algoClOrdId } : {}),
      ...(item.algoId ? { algoOrderId: item.algoId } : {}),
      ...(item.category ? { category: item.category } : {}),
      ...(item.cTime ? { createdAt: new Date(Number(item.cTime)) } : {}),
      ...(item.uTime ? { updatedAt: new Date(Number(item.uTime)) } : {}),
    };
  }

  private safeOrder(
    item: z.infer<typeof orderSchema>,
    source: string,
    instruments: ExchangeInstrument[] = [],
  ): ExchangeOrder[] {
    const symbol = this.tryOkxSwapSymbol(item.instId, source);
    const instrument = symbol
      ? instruments.find((candidate) => candidate.symbol === symbol)
      : undefined;
    return symbol ? [this.order(item, symbol, instrument?.contractSize)] : [];
  }

  private tryOkxSwapSymbol(instId: string, source: string): string | undefined {
    try {
      return fromOkxSymbol(instId);
    } catch (error) {
      this.logger.warn({
        event: "okx_non_swap_record_ignored",
        exchange: this.provider,
        source,
        instId: instId || "<empty>",
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private orderType(value: string): OrderType {
    if (value === "market") return "MARKET";
    if (
      value === "limit" ||
      value === "post_only" ||
      value === "fok" ||
      value === "ioc"
    )
      return "LIMIT";
    if (value.includes("trigger")) return "STOP";
    return "UNKNOWN";
  }

  private orderStatus(value: string): OrderStatus {
    const statuses: Record<string, OrderStatus> = {
      live: "NEW",
      partially_filled: "PARTIALLY_FILLED",
      filled: "FILLED",
      canceled: "CANCELED",
      mmp_canceled: "CANCELED",
    };
    return statuses[value] ?? "UNKNOWN";
  }

  private positionSide(value: string): PositionSide {
    return value === "long" ? "LONG" : value === "short" ? "SHORT" : "BOTH";
  }
}
