import { Injectable, Optional } from "@nestjs/common";
import { z } from "zod";
import type { ToolDefinition } from "../../domain/contracts/tool-definition.contract";
import type { ToolExecutionContext } from "../../domain/contracts/tool-context.contract";
import { MarketToolDataService } from "./market-tool-data.service";

@Injectable()
export class MarketTickerGetTool implements ToolDefinition<{ symbol: string; provider?: string }, Record<string, unknown>> {
  constructor(@Optional() private readonly dataService?: MarketToolDataService) {}
  public readonly name = "market.ticker.get";
  public readonly version = 1;
  public readonly displayName = "Get Market Ticker";
  public readonly description = "Fetch spot and perpetual futures ticker price and 24h stats for a cryptocurrency symbol";
  public readonly category = "MARKET_DATA" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().describe("Symbol name e.g. BTC-USDT or ETH-USDT"),
    provider: z.string().optional().describe("Exchange provider e.g. BINANCE or OKX"),
  });

  public readonly outputSchema = z.object({
    symbol: z.string(),
    price: z.string(),
    high24h: z.string().optional(),
    low24h: z.string().optional(),
    volume24h: z.string().optional(),
    priceChangePercent24h: z.string().optional(),
    timestamp: z.string(),
    stale: z.boolean(),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "PUBLIC" as const;
  public readonly sideEffect = "NONE" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 5 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: ["TIMEOUT"] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = false;
  public readonly userScoped = false;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_MARKET_DATA" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-market-ticker-get-v1";

  public async execute(input: { symbol: string; provider?: string }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    if (!this.dataService) throw new Error("Phase 4 market data service is unavailable");
    const ticker = await this.dataService.ticker(input.symbol, input.provider);
    if (!ticker) throw new Error("Current ticker data is unavailable");
    const timestamp = new Date(ticker.timestamp);
    return {
      symbol: input.symbol,
      provider: ticker.provider,
      price: ticker.lastPrice,
      high24h: ticker.high24h,
      low24h: ticker.low24h,
      volume24h: ticker.volume24h,
      priceChangePercent24h: ticker.priceChangePercent24h,
      bidPrice: ticker.bidPrice,
      askPrice: ticker.askPrice,
      timestamp: timestamp.toISOString(),
      stale: Date.now() - timestamp.getTime() > 10_000,
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class MarketCandlesListTool implements ToolDefinition<{ symbol: string; provider?: string; interval?: string; limit?: number }, Record<string, unknown>> {
  constructor(@Optional() private readonly dataService?: MarketToolDataService) {}
  public readonly name = "market.candles.list";
  public readonly version = 1;
  public readonly displayName = "List Market Candles";
  public readonly description = "Fetch historical candlestick (kline) data for a cryptocurrency symbol";
  public readonly category = "MARKET_DATA" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().describe("Symbol name e.g. BTC-USDT"),
    provider: z.enum(["BINANCE_FUTURES", "OKX_FUTURES"]).optional(),
    interval: z.string().optional().default("1h").describe("Candle interval: 1m, 5m, 15m, 1h, 4h, 1d"),
    limit: z.number().int().min(1).max(500).optional().default(100).describe("Number of candles to return"),
  });

  public readonly outputSchema = z.object({
    symbol: z.string(),
    interval: z.string(),
    candles: z.array(z.record(z.unknown())),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "PUBLIC" as const;
  public readonly sideEffect = "READ_ONLY" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 15 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = false;
  public readonly userScoped = false;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_MARKET_DATA" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-market-candles-list-v1";

  public async execute(input: { symbol: string; provider?: string; interval?: string; limit?: number }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    if (!this.dataService) throw new Error("Phase 4 market data service is unavailable");
    const limit = input.limit || 100;
    const interval = input.interval || "1h";
    const candles = await this.dataService.candles(input.symbol, input.provider, interval, limit);
    if (candles.length === 0) throw new Error("Candle data is unavailable");

    return {
      symbol: input.symbol,
      provider: input.provider,
      interval,
      candles: candles.map((candle) => ({
        timestamp: candle.openTime.toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        isClosed: candle.isClosed,
      })),
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class MarketIndicatorsGetTool implements ToolDefinition<{ symbol: string; provider?: string; interval?: string }, Record<string, unknown>> {
  constructor(@Optional() private readonly dataService?: MarketToolDataService) {}
  public readonly name = "market.indicators.get";
  public readonly version = 1;
  public readonly displayName = "Get Technical Indicators";
  public readonly description = "Fetch technical indicator snapshot (RSI, EMA20, EMA50, MACD, ATR, Bollinger Bands) for a symbol";
  public readonly category = "TECHNICAL_INDICATOR" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().describe("Symbol name e.g. BTC-USDT"),
    provider: z.enum(["BINANCE_FUTURES", "OKX_FUTURES"]).optional(),
    interval: z.string().optional().default("1h").describe("Indicator timeframe e.g. 15m, 1h, 4h, 1d"),
  });

  public readonly outputSchema = z.object({
    symbol: z.string(),
    interval: z.string(),
    rsi: z.string().optional(),
    ema20: z.string().optional(),
    ema50: z.string().optional(),
    macdHistogram: z.string().optional(),
    atr: z.string().optional(),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "PUBLIC" as const;
  public readonly sideEffect = "READ_ONLY" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 10 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = false;
  public readonly userScoped = false;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_INDICATORS" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-market-indicators-get-v1";

  public async execute(input: { symbol: string; provider?: string; interval?: string }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    if (!this.dataService) throw new Error("Phase 4 market data service is unavailable");
    const interval = input.interval || "1h";
    const snapshot = await this.dataService.indicators(input.symbol, input.provider, interval);
    if (!snapshot) throw new Error("Indicator data is unavailable");
    return {
      symbol: input.symbol,
      provider: snapshot.provider,
      interval,
      rsi: snapshot.values.rsi14,
      ema20: snapshot.values.ema20,
      ema50: snapshot.values.ema50,
      macdHistogram: snapshot.values.macd?.histogram,
      atr: snapshot.values.atr14,
      sma20: snapshot.values.sma20,
      sma50: snapshot.values.sma50,
      calculatedAt: snapshot.calculatedAt.toISOString(),
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class MarketFundingGetTool implements ToolDefinition<{ symbol: string; provider?: string }, Record<string, unknown>> {
  constructor(@Optional() private readonly dataService?: MarketToolDataService) {}
  public readonly name = "market.funding.get";
  public readonly version = 1;
  public readonly displayName = "Get Funding Rate";
  public readonly description = "Fetch current and predicted perpetual futures funding rate for a symbol";
  public readonly category = "MARKET_DATA" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().describe("Symbol name e.g. BTC-USDT"),
    provider: z.enum(["BINANCE_FUTURES", "OKX_FUTURES"]).optional(),
  });

  public readonly outputSchema = z.object({
    symbol: z.string(),
    fundingRate: z.string(),
    predictedRate: z.string().optional(),
    nextFundingTime: z.string().optional(),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "PUBLIC" as const;
  public readonly sideEffect = "NONE" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 15 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = false;
  public readonly userScoped = false;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_MARKET_DATA" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-market-funding-get-v1";

  public async execute(input: { symbol: string; provider?: string }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    if (!this.dataService) throw new Error("Phase 4 market data service is unavailable");
    const history = await this.dataService.funding(input.symbol, input.provider);
    const current = history[0];
    if (!current) throw new Error("Funding data is unavailable");
    return {
      symbol: input.symbol,
      provider: current.provider,
      fundingRate: current.fundingRate,
      nextFundingTime: current.nextFundingTime?.toISOString(),
      history: history.map((item) => ({ rate: item.fundingRate, timestamp: item.fundingTime.toISOString() })),
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class MarketOpenInterestGetTool implements ToolDefinition<{ symbol: string; provider?: string }, Record<string, unknown>> {
  constructor(@Optional() private readonly dataService?: MarketToolDataService) {}
  public readonly name = "market.open_interest.get";
  public readonly version = 1;
  public readonly displayName = "Get Open Interest";
  public readonly description = "Fetch open interest total contracts and USD value for a perpetual futures contract";
  public readonly category = "MARKET_DATA" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().describe("Symbol name e.g. BTC-USDT"),
    provider: z.enum(["BINANCE_FUTURES", "OKX_FUTURES"]).optional(),
  });

  public readonly outputSchema = z.object({
    symbol: z.string(),
    openInterest: z.string(),
    openInterestUsd: z.string().optional(),
    timestamp: z.string(),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "PUBLIC" as const;
  public readonly sideEffect = "NONE" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 15 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = false;
  public readonly userScoped = false;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_MARKET_DATA" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-market-open-interest-get-v1";

  public async execute(input: { symbol: string; provider?: string }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    if (!this.dataService) throw new Error("Phase 4 market data service is unavailable");
    const history = await this.dataService.openInterest(input.symbol, input.provider);
    const current = history[0];
    if (!current) throw new Error("Open-interest data is unavailable");
    return {
      symbol: input.symbol,
      provider: current.provider,
      openInterest: current.openInterest,
      openInterestUsd: current.openInterestValue,
      timestamp: current.timestamp.toISOString(),
      history: history.map((item) => ({ value: item.openInterest, timestamp: item.timestamp.toISOString() })),
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class MarketOrderBookGetTool implements ToolDefinition<{ symbol: string; provider?: string; depth?: number }, Record<string, unknown>> {
  constructor(@Optional() private readonly dataService?: MarketToolDataService) {}
  public readonly name = "market.order_book.get";
  public readonly version = 1;
  public readonly displayName = "Get Order Book Depth";
  public readonly description = "Fetch top bid/ask order book depth for a cryptocurrency symbol";
  public readonly category = "MARKET_DATA" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().describe("Symbol name e.g. BTC-USDT"),
    provider: z.enum(["BINANCE_FUTURES", "OKX_FUTURES"]).optional(),
    depth: z.number().int().min(1).max(50).optional().default(10).describe("Depth level count"),
  });

  public readonly outputSchema = z.object({
    symbol: z.string(),
    bids: z.array(z.array(z.string())),
    asks: z.array(z.array(z.string())),
    timestamp: z.string(),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "PUBLIC" as const;
  public readonly sideEffect = "NONE" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 3 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = false;
  public readonly userScoped = false;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_MARKET_DATA" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-market-order-book-get-v1";

  public async execute(input: { symbol: string; provider?: string; depth?: number }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    if (!this.dataService) throw new Error("Phase 4 market data service is unavailable");
    const depth = input.depth || 10;
    const book = await this.dataService.orderBook(input.symbol, input.provider, depth);
    if (!book) throw new Error("Order-book data is unavailable");
    return {
      symbol: input.symbol,
      provider: book.provider,
      depth,
      bids: book.bids.map((level) => [level.price, level.quantity]),
      asks: book.asks.map((level) => [level.price, level.quantity]),
      timestamp: book.timestamp.toISOString(),
      invocationId: context.invocationId,
    };
  }
}
