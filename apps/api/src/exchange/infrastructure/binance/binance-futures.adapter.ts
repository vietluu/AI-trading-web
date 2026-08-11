import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";

import type { ExchangeAdapter } from "../../domain/exchange.adapter";
import { ExchangeError, ExchangeErrorCode } from "../../domain/exchange.error";
import { normalizeClientOrderId } from "../client-order-id";
import {
  ExchangeEnvironment,
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
  type OrderStatus,
  type OrderType,
  type PositionSide,
  type TimeInForce,
} from "../../domain/exchange.types";
import { toBinanceInterval } from "../exchange-interval";
import { fromAssets, mapSymbol, toBinanceSymbol } from "../exchange-symbol";
import { BinanceFuturesClient } from "./binance-futures.client";

const decimal = z.string();
const filterSchema = z.object({
  filterType: z.string(),
  tickSize: decimal.optional(),
  stepSize: decimal.optional(),
  minQty: decimal.optional(),
  maxQty: decimal.optional(),
  notional: decimal.optional(),
  minNotional: decimal.optional(),
});
const symbolSchema = z.object({
  symbol: z.string(),
  pair: z.string().optional(),
  contractType: z.string(),
  status: z.string(),
  baseAsset: z.string(),
  quoteAsset: z.string(),
  marginAsset: z.string(),
  pricePrecision: z.number().int(),
  quantityPrecision: z.number().int(),
  orderTypes: z.array(z.string()).default([]),
  filters: z.array(filterSchema),
});
const exchangeInfoSchema = z.object({
  timezone: z.string(),
  serverTime: z.number().int().optional(),
  symbols: z.array(symbolSchema),
});
const tickerSchema = z.object({
  symbol: z.string(),
  lastPrice: decimal,
  highPrice: decimal,
  lowPrice: decimal,
  volume: decimal,
  quoteVolume: decimal,
  priceChange: decimal,
  priceChangePercent: decimal,
  closeTime: z.number().int(),
  bidPrice: decimal.optional(),
  askPrice: decimal.optional(),
});
const premiumSchema = z.object({
  markPrice: decimal,
  indexPrice: decimal,
  lastFundingRate: decimal,
  nextFundingTime: z.number().int(),
  time: z.number().int(),
});
const bookSchema = z.object({
  E: z.number().int().optional(),
  T: z.number().int().optional(),
  bids: z.array(z.tuple([decimal, decimal])).or(z.array(z.array(decimal))),
  asks: z.array(z.tuple([decimal, decimal])).or(z.array(z.array(decimal))),
});
const tradeSchema = z.object({
  id: z.number().int(),
  price: decimal,
  qty: decimal,
  time: z.number().int(),
  isBuyerMaker: z.boolean(),
});
const klineSchema = z.tuple([
  z.number().int(),
  decimal,
  decimal,
  decimal,
  decimal,
  decimal,
  z.number().int(),
  decimal,
  z.number().int(),
  decimal,
  decimal,
  z.string(),
]);
const openInterestSchema = z.object({
  openInterest: decimal,
  symbol: z.string(),
  time: z.number().int(),
});
const accountSchema = z.object({
  totalWalletBalance: decimal,
  availableBalance: decimal,
  totalUnrealizedProfit: decimal,
  totalMarginBalance: decimal,
  canTrade: z.boolean(),
  updateTime: z.number().int().optional(),
});
const balanceSchema = z.object({
  asset: z.string(),
  balance: decimal,
  availableBalance: decimal,
  crossWalletBalance: decimal.optional(),
  crossUnPnl: decimal.optional(),
});
const positionSchema = z.object({
  symbol: z.string(),
  positionAmt: decimal,
  entryPrice: decimal,
  markPrice: decimal.optional(),
  unRealizedProfit: decimal,
  liquidationPrice: decimal.optional(),
  leverage: decimal.optional(),
  marginType: z.string().optional(),
  isolatedMargin: decimal.optional(),
  notional: decimal.optional(),
  positionSide: z.string().optional(),
  updateTime: z.number().int().optional(),
});
const orderSchema = z.object({
  symbol: z.string(),
  orderId: z.union([z.string(), z.number()]),
  clientOrderId: z.string().optional(),
  side: z.string(),
  type: z.string(),
  status: z.string(),
  timeInForce: z.string().optional(),
  price: decimal.optional(),
  stopPrice: decimal.optional(),
  avgPrice: decimal.optional(),
  origQty: decimal,
  executedQty: decimal,
  reduceOnly: z.boolean().optional(),
  positionSide: z.string().optional(),
  time: z.number().int().optional(),
  updateTime: z.number().int().optional(),
});
const userTradeSchema = z.object({
  id: z.union([z.string(), z.number()]),
  orderId: z.union([z.string(), z.number()]),
  symbol: z.string(),
  side: z.string(),
  positionSide: z.string().optional(),
  price: decimal,
  qty: decimal,
  quoteQty: decimal.optional(),
  realizedPnl: decimal.default("0"),
  commission: decimal.default("0"),
  commissionAsset: z.string().optional(),
  maker: z.boolean().optional(),
  time: z.number().int(),
});

@Injectable()
export class BinanceFuturesAdapter implements ExchangeAdapter {
  readonly provider = ExchangeProvider.BINANCE_FUTURES;
  private readonly logger = new Logger(BinanceFuturesAdapter.name);

  constructor(private readonly client: BinanceFuturesClient) {}

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
          this.getServerTime(credentials.environment),
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
          trading: account.canTrade,
        },
        serverTime: serverTime.serverTime,
        latencyMs: Date.now() - started,
      };
    } catch (caught) {
      const error = this.exchangeError(caught);
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

  async getServerTime(
    environment = ExchangeEnvironment.PRODUCTION,
  ): Promise<ExchangeServerTime> {
    const localTime = new Date();
    const serverTime = new Date(await this.client.serverTime(environment));
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
    const value = exchangeInfoSchema.parse(
      await this.client.publicGet("/fapi/v1/exchangeInfo", {}, environment),
    );
    return {
      provider: this.provider,
      environment,
      timezone: value.timezone,
      ...(value.serverTime ? { serverTime: new Date(value.serverTime) } : {}),
      instrumentCount: value.symbols.length,
    };
  }

  async getInstruments(query?: InstrumentQuery): Promise<ExchangeInstrument[]> {
    const value = exchangeInfoSchema.parse(
      await this.client.publicGet("/fapi/v1/exchangeInfo"),
    );
    return value.symbols
      .map((item) => this.instrument(item))
      .filter((item) => !query?.status || item.status === query.status);
  }

  async getTicker(symbol: string): Promise<ExchangeTicker> {
    const exchangeSymbol = toBinanceSymbol(symbol);
    const [ticker, premium] = await Promise.all([
      this.client
        .publicGet("/fapi/v1/ticker/24hr", { symbol: exchangeSymbol })
        .then((value) => tickerSchema.parse(value)),
      this.client
        .publicGet("/fapi/v1/premiumIndex", { symbol: exchangeSymbol })
        .then((value) => premiumSchema.parse(value)),
    ]);
    return {
      provider: this.provider,
      symbol: symbol.toUpperCase(),
      lastPrice: ticker.lastPrice,
      markPrice: premium.markPrice,
      indexPrice: premium.indexPrice,
      ...(ticker.bidPrice ? { bidPrice: ticker.bidPrice } : {}),
      ...(ticker.askPrice ? { askPrice: ticker.askPrice } : {}),
      high24h: ticker.highPrice,
      low24h: ticker.lowPrice,
      volume24h: ticker.volume,
      quoteVolume24h: ticker.quoteVolume,
      priceChange24h: ticker.priceChange,
      priceChangePercent24h: ticker.priceChangePercent,
      timestamp: new Date(ticker.closeTime),
    };
  }

  async getOrderBook(symbol: string, depth = 20): Promise<ExchangeOrderBook> {
    const value = bookSchema.parse(
      await this.client.publicGet("/fapi/v1/depth", {
        symbol: toBinanceSymbol(symbol),
        limit: depth,
      }),
    );
    return {
      provider: this.provider,
      symbol: symbol.toUpperCase(),
      bids: value.bids.map((level) => ({
        price: level[0],
        quantity: level[1],
      })),
      asks: value.asks.map((level) => ({
        price: level[0],
        quantity: level[1],
      })),
      timestamp: new Date(value.T ?? value.E ?? Date.now()),
    };
  }

  async getRecentTrades(symbol: string, limit = 100): Promise<ExchangeTrade[]> {
    const values = z.array(tradeSchema).parse(
      await this.client.publicGet("/fapi/v1/trades", {
        symbol: toBinanceSymbol(symbol),
        limit,
      }),
    );
    return values.map((trade) => ({
      provider: this.provider,
      symbol: symbol.toUpperCase(),
      tradeId: String(trade.id),
      price: trade.price,
      quantity: trade.qty,
      side: trade.isBuyerMaker ? "SELL" : "BUY",
      timestamp: new Date(trade.time),
    }));
  }

  async getKlines(query: KlineQuery): Promise<ExchangeKline[]> {
    const now = Date.now();
    const values = z.array(klineSchema).parse(
      await this.client.publicGet("/fapi/v1/klines", {
        symbol: toBinanceSymbol(query.symbol),
        interval: toBinanceInterval(query.interval),
        limit: query.limit,
        startTime: query.startTime?.getTime(),
        endTime: query.endTime?.getTime(),
      }),
    );
    return values.map((item) => ({
      provider: this.provider,
      symbol: query.symbol.toUpperCase(),
      interval: query.interval,
      openTime: new Date(item[0]),
      closeTime: new Date(item[6]),
      open: item[1],
      high: item[2],
      low: item[3],
      close: item[4],
      volume: item[5],
      quoteVolume: item[7],
      tradeCount: item[8],
      isClosed: item[6] < now,
    }));
  }

  async getFundingRate(symbol: string): Promise<ExchangeFundingRate> {
    const value = premiumSchema.parse(
      await this.client.publicGet("/fapi/v1/premiumIndex", {
        symbol: toBinanceSymbol(symbol),
      }),
    );
    return {
      provider: this.provider,
      symbol: symbol.toUpperCase(),
      fundingRate: value.lastFundingRate,
      fundingTime: new Date(value.time),
      nextFundingTime: new Date(value.nextFundingTime),
      markPrice: value.markPrice,
    };
  }

  async getOpenInterest(symbol: string): Promise<ExchangeOpenInterest> {
    const value = openInterestSchema.parse(
      await this.client.publicGet("/fapi/v1/openInterest", {
        symbol: toBinanceSymbol(symbol),
      }),
    );
    return {
      provider: this.provider,
      symbol: symbol.toUpperCase(),
      openInterest: value.openInterest,
      timestamp: new Date(value.time),
    };
  }

  async getAccountSummary(
    credentials: ExchangeCredentials,
  ): Promise<ExchangeAccountSummary> {
    const value = accountSchema.parse(
      await this.client.signedGet("/fapi/v3/account", credentials),
    );
    return {
      provider: this.provider,
      // Binance margin balance includes unrealized PnL and is the actual
      // mark-to-market equity used by risk and portfolio calculations.
      totalEquity: value.totalMarginBalance,
      availableBalance: value.availableBalance,
      totalUnrealizedPnl: value.totalUnrealizedProfit,
      totalMarginBalance: value.totalMarginBalance,
      canTrade: value.canTrade,
      updatedAt: new Date(value.updateTime ?? Date.now()),
    };
  }

  async getBalances(
    credentials: ExchangeCredentials,
  ): Promise<ExchangeBalance[]> {
    const values = z
      .array(balanceSchema)
      .parse(await this.client.signedGet("/fapi/v3/balance", credentials));
    return values.map((item) => ({
      provider: this.provider,
      asset: item.asset,
      total: item.balance,
      available: item.availableBalance,
      ...(item.crossWalletBalance
        ? { marginBalance: item.crossWalletBalance }
        : {}),
      ...(item.crossUnPnl ? { unrealizedPnl: item.crossUnPnl } : {}),
    }));
  }

  async getPositions(
    credentials: ExchangeCredentials,
  ): Promise<ExchangePosition[]> {
    const values = z
      .array(positionSchema)
      .parse(await this.client.signedGet("/fapi/v3/positionRisk", credentials));
    return values
      .filter((item) => item.positionAmt !== "0" && item.positionAmt !== "0.0")
      .map((item) => {
        const numeric = Number(item.positionAmt);
        const side: PositionSide =
          item.positionSide === "LONG" || item.positionSide === "SHORT"
            ? item.positionSide
            : numeric < 0
              ? "SHORT"
              : "LONG";
        return {
          provider: this.provider,
          symbol: this.symbolFromKnownQuotes(item.symbol),
          side,
          positionMode:
            item.positionSide === "BOTH" || !item.positionSide
              ? "ONE_WAY"
              : "HEDGE",
          quantity: item.positionAmt.startsWith("-")
            ? item.positionAmt.slice(1)
            : item.positionAmt,
          entryPrice: item.entryPrice,
          ...(item.markPrice ? { markPrice: item.markPrice } : {}),
          ...(item.liquidationPrice
            ? { liquidationPrice: item.liquidationPrice }
            : {}),
          ...(item.leverage ? { leverage: item.leverage } : {}),
          ...(item.marginType
            ? {
                marginType:
                  item.marginType.toUpperCase() === "ISOLATED"
                    ? "ISOLATED"
                    : "CROSS",
              }
            : {}),
          ...(item.isolatedMargin ? { margin: item.isolatedMargin } : {}),
          unrealizedPnl: item.unRealizedProfit,
          ...(item.notional ? { notional: item.notional } : {}),
          updatedAt: new Date(item.updateTime ?? Date.now()),
        };
      });
  }

  async getOpenOrders(
    credentials: ExchangeCredentials,
    query?: OpenOrderQuery,
  ): Promise<ExchangeOrder[]> {
    const values = z.array(orderSchema).parse(
      await this.client.signedGet("/fapi/v1/openOrders", credentials, {
        symbol: query?.symbol ? toBinanceSymbol(query.symbol) : undefined,
      }),
    );
    return values.map((order) => this.order(order));
  }

  async getOrderHistory(
    credentials: ExchangeCredentials,
    symbols: string[] = [],
    limit = 20,
  ): Promise<ExchangeOrder[]> {
    if (!symbols.length) return [];
    const historyLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const pages = await Promise.all(
      symbols.map((symbol) =>
        this.client
          .signedGet("/fapi/v1/allOrders", credentials, {
            symbol: toBinanceSymbol(symbol),
            limit: historyLimit,
          })
          .then((value) => z.array(orderSchema).parse(value)),
      ),
    );
    return pages
      .flat()
      .map((order) => this.order(order))
      .sort(
        (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
      )
      .slice(0, historyLimit);
  }

  async getTradeFills(
    credentials: ExchangeCredentials,
    symbols: string[] = [],
    limit = 100,
    before?: Date,
  ): Promise<ExchangeFill[]> {
    if (!symbols.length) return [];
    const historyLimit = Math.min(1000, Math.max(1, Math.trunc(limit)));
    const pages = await Promise.all(
      [...new Set(symbols)].map((symbol) =>
        this.client
          .signedGet("/fapi/v1/userTrades", credentials, {
            symbol: toBinanceSymbol(symbol),
            limit: historyLimit,
            ...(before ? { endTime: before.getTime() } : {}),
          })
          .then((value) => z.array(userTradeSchema).parse(value)),
      ),
    );
    return pages
      .flat()
      .map((item) => {
        const positionSide = item.positionSide as PositionSide | undefined;
        const realizedPnl = Number(item.realizedPnl);
        return {
          provider: this.provider,
          symbol: this.symbolFromKnownQuotes(item.symbol),
          exchangeTradeId: String(item.id),
          exchangeOrderId: String(item.orderId),
          side: item.side === "SELL" ? "SELL" as const : "BUY" as const,
          ...(positionSide ? { positionSide } : {}),
          price: item.price,
          quantity: item.qty,
          ...(item.quoteQty ? { quoteQuantity: item.quoteQty } : {}),
          realizedPnl: item.realizedPnl,
          fee: String(-Math.abs(Number(item.commission))),
          ...(item.commissionAsset ? { feeAsset: item.commissionAsset } : {}),
          ...(item.maker === undefined ? {} : { isMaker: item.maker }),
          isClosing:
            realizedPnl !== 0 ||
            (positionSide === "LONG" && item.side === "SELL") ||
            (positionSide === "SHORT" && item.side === "BUY"),
          executedAt: new Date(item.time),
        };
      })
      .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())
      .slice(0, historyLimit);
  }

  async getOrder(
    credentials: ExchangeCredentials,
    query: GetOrderQuery,
  ): Promise<ExchangeOrder> {
    return this.order(
      orderSchema.parse(
        await this.client.signedGet("/fapi/v1/order", credentials, {
          symbol: toBinanceSymbol(query.symbol),
          orderId: query.orderId,
        }),
      ),
    );
  }

  async getAccountConfiguration(
    credentials: ExchangeCredentials,
  ): Promise<ExchangeAccountConfiguration> {
    const [account, positionMode] = await Promise.all([
      this.getAccountSummary(credentials),
      this.client
        .signedGet("/fapi/v1/positionSide/dual", credentials)
        .then((value) =>
          z.object({ dualSidePosition: z.boolean() }).parse(value),
        ),
    ]);
    return {
      provider: this.provider,
      positionMode: positionMode.dualSidePosition ? "HEDGE" : "ONE_WAY",
      canTrade: account.canTrade,
    };
  }

  async placeOrder(
    credentials: ExchangeCredentials,
    command: PlaceOrderCommand,
  ): Promise<ExchangeOrder> {
    const normalizedSymbol = mapSymbol(command.symbol, this.provider);
    const symbol = normalizedSymbol;
    const leverage = Math.max(
      1,
      Math.min(125, Math.round(Number(command.leverage) || 1)),
    );
    await this.client.signedPost("/fapi/v1/leverage", credentials, {
      symbol,
      leverage,
    });
    try {
      const value = orderSchema.parse(
        await this.client.signedPost("/fapi/v1/order", credentials, {
          symbol,
          side: command.side,
          type: "MARKET",
          quantity: command.quantity,
          newClientOrderId: normalizeClientOrderId(command.clientOrderId),
          reduceOnly: command.reduceOnly,
          positionSide: command.positionSide,
          newOrderRespType: "RESULT",
        }),
      );
      return this.order(value);
    } catch (caught) {
      const error = this.exchangeError(caught);
      this.logger.warn({
        event: "exchange_order_failed",
        exchange: this.provider,
        originalSymbol: command.symbol,
        normalizedSymbol: symbol,
        response: error,
      });
      throw error;
    }
  }

  async cancelOrder(
    credentials: ExchangeCredentials,
    command: CancelOrderCommand,
  ): Promise<ExchangeOrder> {
    const value = orderSchema.parse(
      await this.client.signedDelete("/fapi/v1/order", credentials, {
        symbol: toBinanceSymbol(command.symbol),
        orderId: command.orderId,
        origClientOrderId: normalizeClientOrderId(command.clientOrderId),
      }),
    );
    return this.order(value);
  }

  private instrument(item: z.infer<typeof symbolSchema>): ExchangeInstrument {
    const price = item.filters.find(
      (filter) => filter.filterType === "PRICE_FILTER",
    );
    let symbol = `${item.baseAsset}-${item.quoteAsset}`;
    try {
      symbol = fromAssets(item.baseAsset, item.quoteAsset);
    } catch {
      symbol = `${item.baseAsset}-${item.quoteAsset}`;
    }
    const lot = item.filters.find((filter) => filter.filterType === "LOT_SIZE");
    const notional = item.filters.find(
      (filter) =>
        filter.filterType === "MIN_NOTIONAL" ||
        filter.filterType === "NOTIONAL",
    );
    const minNotional = notional?.notional ?? notional?.minNotional;
    const status =
      item.status === "TRADING"
        ? "TRADING"
        : item.status === "PENDING_TRADING"
          ? "PRE_TRADING"
          : "SUSPENDED";
    return {
      provider: this.provider,
      symbol,
      baseAsset: item.baseAsset,
      quoteAsset: item.quoteAsset,
      settlementAsset: item.marginAsset,
      instrumentType:
        item.contractType === "PERPETUAL" ? "PERPETUAL" : "FUTURE",
      status,
      pricePrecision: item.pricePrecision,
      quantityPrecision: item.quantityPrecision,
      tickSize: price?.tickSize ?? "0",
      stepSize: lot?.stepSize ?? "0",
      ...(lot?.minQty ? { minQuantity: lot.minQty } : {}),
      ...(lot?.maxQty ? { maxQuantity: lot.maxQty } : {}),
      ...(minNotional ? { minNotional } : {}),
      supportsMarketOrder: item.orderTypes.includes("MARKET"),
      supportsLimitOrder: item.orderTypes.includes("LIMIT"),
      supportsStopOrder: item.orderTypes.some((type) =>
        type.startsWith("STOP"),
      ),
    };
  }

  private order(item: z.infer<typeof orderSchema>): ExchangeOrder {
    return {
      provider: this.provider,
      symbol: this.symbolFromKnownQuotes(item.symbol),
      exchangeOrderId: String(item.orderId),
      ...(item.clientOrderId ? { clientOrderId: item.clientOrderId } : {}),
      side: item.side === "SELL" ? "SELL" : "BUY",
      type: this.orderType(item.type),
      status: this.orderStatus(item.status),
      ...(item.timeInForce
        ? { timeInForce: item.timeInForce as TimeInForce }
        : {}),
      ...(item.price ? { price: item.price } : {}),
      ...(item.stopPrice ? { stopPrice: item.stopPrice } : {}),
      ...(item.avgPrice ? { averagePrice: item.avgPrice } : {}),
      originalQuantity: item.origQty,
      executedQuantity: item.executedQty,
      ...(item.reduceOnly === undefined ? {} : { reduceOnly: item.reduceOnly }),
      ...(item.positionSide
        ? { positionSide: item.positionSide as PositionSide }
        : {}),
      ...(item.time ? { createdAt: new Date(item.time) } : {}),
      ...(item.updateTime ? { updatedAt: new Date(item.updateTime) } : {}),
    };
  }

  private symbolFromKnownQuotes(symbol: string): string {
    const quote = ["USDT", "USDC", "FDUSD"].find((asset) =>
      symbol.endsWith(asset),
    );
    if (!quote)
      throw ExchangeError.invalidRequest(
        this.provider,
        "Unsupported Binance settlement asset",
      );
    return fromAssets(symbol.slice(0, -quote.length), quote);
  }

  private orderType(value: string): OrderType {
    return (
      ["MARKET", "LIMIT", "STOP", "STOP_MARKET", "TAKE_PROFIT"] as string[]
    ).includes(value)
      ? (value as OrderType)
      : "UNKNOWN";
  }

  private orderStatus(value: string): OrderStatus {
    return (
      [
        "NEW",
        "PARTIALLY_FILLED",
        "FILLED",
        "CANCELED",
        "REJECTED",
        "EXPIRED",
      ] as string[]
    ).includes(value)
      ? (value as OrderStatus)
      : "UNKNOWN";
  }

  private exchangeError(caught: unknown): ExchangeError {
    return caught instanceof ExchangeError
      ? caught
      : new ExchangeError(
          ExchangeErrorCode.UNKNOWN,
          this.provider,
          false,
          502,
          "Unexpected Binance response",
        );
  }
}
