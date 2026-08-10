import { Injectable, Logger } from "@nestjs/common";
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
  cashBal: decimal,
  availBal: decimal,
  frozenBal: decimal.optional(),
  upl: decimal.optional(),
  eq: decimal.optional(),
});
const accountSchema = z.object({
  totalEq: decimal,
  availEq: decimal.optional(),
  upl: decimal.optional(),
  details: z.array(balanceDetailSchema),
  uTime: z.string().regex(/^\d+$/),
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
  cTime: z.string().regex(/^\d+$/).optional(),
  uTime: z.string().regex(/^\d+$/).optional(),
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
const algoAckSchema = z.object({
  algoId: z.string().optional(),
  algoClOrdId: z.string().optional(),
  sCode: z.string(),
  sMsg: z.string().optional(),
});

@Injectable()
export class OkxFuturesAdapter implements ExchangeAdapter {
  readonly provider = ExchangeProvider.OKX_FUTURES;
  private readonly logger = new Logger(OkxFuturesAdapter.name);

  constructor(private readonly client: OkxFuturesClient) {}

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
      await this.client.publicGet("/api/v5/public/instruments", params),
    );
    return values
      .map((item) => this.instrument(item))
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
    const value = z
      .array(accountSchema)
      .min(1)
      .parse(
        await this.client.signedGet("/api/v5/account/balance", credentials),
      )[0]!;
    const settlement =
      value.details.find((detail) => detail.ccy === "USDT") ?? value.details[0];
    const available = this.nonEmptyDecimal(value.availEq, settlement?.availBal);
    const upl = this.nonEmptyDecimal(value.upl, settlement?.upl);
    return {
      provider: this.provider,
      totalEquity: value.totalEq,
      availableBalance: available,
      totalUnrealizedPnl: upl,
      totalMarginBalance: value.totalEq,
      canTrade: false,
      updatedAt: new Date(Number(value.uTime)),
    };
  }

  async getBalances(
    credentials: ExchangeCredentials,
  ): Promise<ExchangeBalance[]> {
    const value = z
      .array(accountSchema)
      .min(1)
      .parse(
        await this.client.signedGet("/api/v5/account/balance", credentials),
      )[0]!;
    return value.details.map((item) => ({
      provider: this.provider,
      asset: item.ccy,
      total: item.cashBal,
      available: item.availBal,
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
      this.getInstruments(),
    ]);
    const values = z.array(positionSchema).parse(rawPositions);
    return values
      .filter((item) => item.pos !== "0" && item.pos !== "0.0")
      .map((item) => {
        const normalizedSymbol = fromOkxSymbol(item.instId);
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
        return {
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
        };
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
    return values.map((item) => this.order(item));
  }

  async getOrderHistory(
    credentials: ExchangeCredentials,
    _symbols?: string[],
    limit = 20,
  ): Promise<ExchangeOrder[]> {
    const historyLimit = Math.min(20, Math.max(1, Math.trunc(limit)));
    const values = z.array(orderSchema).parse(
      await this.client.signedGet("/api/v5/trade/orders-history", credentials, {
        instType: "SWAP",
        limit: historyLimit,
      }),
    );
    return values.map((item) => this.order(item)).slice(0, historyLimit);
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
      canTrade: false,
    };
  }

  async placeOrder(
    credentials: ExchangeCredentials,
    command: PlaceOrderCommand,
  ): Promise<ExchangeOrder> {
    const normalizedSymbol = mapSymbol(command.symbol, this.provider);
    const instId = normalizedSymbol;
    const searchSymbol = command.symbol.toUpperCase().replace("/", "-");
    const instruments = await this.getInstruments({ symbol: command.symbol });
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
    const contractQuantity = this.contractQuantity(
      command.quantity,
      instrument.contractSize,
      instrument.stepSize,
      instrument.quantityPrecision,
      instrument.maxQuantity,
    );
    try {
      await this.client.signedPost("/api/v5/account/set-leverage", credentials, {
        instId,
        lever: String(command.leverage),
        mgnMode: "cross",
        ...(command.positionSide
          ? { posSide: command.positionSide.toLowerCase() }
          : {}),
      });
    } catch (error) {
      this.logger.warn({
        event: "okx_leverage_setup_failed",
        exchange: this.provider,
        symbol: command.symbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const clOrdId = normalizeClientOrderId(command.clientOrderId) ?? "";
    const protectiveClientOrderId = (command.stopLoss || command.takeProfit)
      ? normalizeClientOrderId(`${clOrdId.slice(0, 28)}pm`)
      : undefined;
    let marketPrice: string | undefined = undefined;
    let ordType: "limit" | "market" = "limit";
    try {
      const ticker = await this.getTicker(command.symbol);
      const selectedPrice =
        command.side.toUpperCase() === "BUY"
          ? ticker.askPrice
          : ticker.bidPrice;
      const numericPrice = Number(selectedPrice);
      if (Number.isFinite(numericPrice) && numericPrice > 0) {
        marketPrice = selectedPrice;
        ordType = "limit";
      }
    } catch (error) {
      this.logger.warn({
        event: "okx_order_price_lookup_failed",
        exchange: this.provider,
        symbol: command.symbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const body: Record<string, unknown> = {
      instId,
      tdMode: "cross",
      side: command.side.toLowerCase(),
      ordType,
      ...(ordType === "limit" && marketPrice ? { px: marketPrice } : {}),
      sz: contractQuantity,
      ...(clOrdId ? { clOrdId } : {}),
      ...(command.positionSide
        ? { posSide: command.positionSide.toLowerCase() }
        : {}),
    };
    const hasSl =
      Number.isFinite(Number(command.stopLoss)) && Number(command.stopLoss) > 0;
    const hasTp =
      Number.isFinite(Number(command.takeProfit)) && Number(command.takeProfit) > 0;
    if (hasSl || hasTp) {
      body.attachAlgoOrds = [
        {
          ...(protectiveClientOrderId
            ? { attachAlgoClOrdId: protectiveClientOrderId }
            : {}),
          ...(hasSl
            ? {
                slTriggerPx: String(command.stopLoss),
                slOrdPx: "-1",
              }
            : {}),
          ...(hasTp
            ? {
                tpTriggerPx: String(command.takeProfit),
                tpOrdPx: "-1",
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
    return {
      provider: this.provider,
      symbol: command.symbol,
      exchangeOrderId: ack.ordId,
      clientOrderId: ack.clOrdId ?? command.clientOrderId,
      side: command.side,
      type: "MARKET",
      status: "NEW",
      originalQuantity: command.quantity,
      executedQuantity: "0",
      reduceOnly: command.reduceOnly ?? false,
      ...(command.positionSide ? { positionSide: command.positionSide } : {}),
      ...(protectiveClientOrderId ? { protectiveClientOrderId } : {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async amendProtectiveOrder(
    credentials: ExchangeCredentials,
    command: AmendProtectiveOrderCommand,
  ): Promise<void> {
    const hasStop = Number.isFinite(Number(command.stopLoss)) && Number(command.stopLoss) > 0;
    const hasTake = Number.isFinite(Number(command.takeProfit)) && Number(command.takeProfit) > 0;
    if (!hasStop && !hasTake) {
      throw ExchangeError.invalidRequest(this.provider, "A protective price is required");
    }
    const response = z.array(algoAckSchema).min(1).parse(
      await this.client.signedPost("/api/v5/trade/amend-algos", credentials, {
        instId: toOkxSymbol(command.symbol),
        algoClOrdId: normalizeClientOrderId(command.protectiveClientOrderId),
        reqId: normalizeClientOrderId(command.requestId),
        cxlOnFail: false,
        ...(hasStop ? { newSlTriggerPx: String(command.stopLoss), newSlOrdPx: "-1" } : {}),
        ...(hasTake ? { newTpTriggerPx: String(command.takeProfit), newTpOrdPx: "-1" } : {}),
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

  private instrument(
    item: z.infer<typeof instrumentSchema>,
  ): ExchangeInstrument {
    const [base = "", quote = ""] = item.instId.split("-");
    const precision = (value: string): number =>
      value.includes(".")
        ? (value.replace(/0+$/, "").split(".")[1]?.length ?? 0)
        : 0;
    const maxQuantity = item.maxMktSz ?? item.maxLmtSz;
    return {
      provider: this.provider,
      symbol: fromOkxSymbol(item.instId),
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
    maxQuantity?: string,
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
    const cappedRaw =
      maxQuantity !== undefined && maxQuantity !== ""
        ? Math.min(raw, Number(maxQuantity))
        : raw;
    const contractCount = Math.max(1, Math.round(cappedRaw + Number.EPSILON));
    if (contractCount <= 0) {
      throw ExchangeError.invalidRequest(
        this.provider,
        `Order size is below the OKX minimum contract lot (${lotSize})`,
      );
    }
    return this.decimalString(contractCount, 0);
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

  private order(item: z.infer<typeof orderSchema>): ExchangeOrder {
    return {
      provider: this.provider,
      symbol: fromOkxSymbol(item.instId),
      exchangeOrderId: item.ordId,
      ...(item.clOrdId ? { clientOrderId: item.clOrdId } : {}),
      side: item.side === "sell" ? "SELL" : "BUY",
      type: this.orderType(item.ordType),
      status: this.orderStatus(item.state),
      ...(item.ordType === "post_only" ? { timeInForce: "POST_ONLY" } : {}),
      ...(item.px ? { price: item.px } : {}),
      ...(item.triggerPx ? { stopPrice: item.triggerPx } : {}),
      ...(item.avgPx ? { averagePrice: item.avgPx } : {}),
      originalQuantity: item.sz,
      executedQuantity: item.accFillSz,
      ...(item.reduceOnly === undefined
        ? {}
        : {
            reduceOnly: item.reduceOnly === true || item.reduceOnly === "true",
          }),
      ...(item.posSide
        ? { positionSide: this.positionSide(item.posSide) }
        : {}),
      ...(item.cTime ? { createdAt: new Date(Number(item.cTime)) } : {}),
      ...(item.uTime ? { updatedAt: new Date(Number(item.uTime)) } : {}),
    };
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
