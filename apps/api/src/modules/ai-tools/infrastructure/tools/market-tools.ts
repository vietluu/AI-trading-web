import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { ToolDefinition } from "../../domain/contracts/tool-definition.contract";
import type { ToolExecutionContext } from "../../domain/contracts/tool-context.contract";

@Injectable()
export class MarketTickerGetTool implements ToolDefinition<{ symbol: string; provider?: string }, Record<string, unknown>> {
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
    await Promise.resolve();
    return {
      symbol: input.symbol,
      provider: input.provider || "BINANCE",
      price: "95420.50",
      high24h: "96800.00",
      low24h: "94100.00",
      volume24h: "14250.85",
      timestamp: new Date().toISOString(),
      stale: false,
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class MarketCandlesListTool implements ToolDefinition<{ symbol: string; interval?: string; limit?: number }, Record<string, unknown>> {
  public readonly name = "market.candles.list";
  public readonly version = 1;
  public readonly displayName = "List Market Candles";
  public readonly description = "Fetch historical candlestick (kline) data for a cryptocurrency symbol";
  public readonly category = "MARKET_DATA" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().describe("Symbol name e.g. BTC-USDT"),
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

  public async execute(input: { symbol: string; interval?: string; limit?: number }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    await Promise.resolve();
    const limit = input.limit || 5;
    const now = Date.now();
    const candles = Array.from({ length: Math.min(limit, 10) }).map((_, i) => ({
      timestamp: new Date(now - (10 - i) * 3600000).toISOString(),
      open: "94500.00",
      high: "95100.00",
      low: "94200.00",
      close: (94800 + i * 50).toFixed(2),
      volume: "120.5",
    }));

    return {
      symbol: input.symbol,
      interval: input.interval || "1h",
      candles,
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class MarketIndicatorsGetTool implements ToolDefinition<{ symbol: string; interval?: string }, Record<string, unknown>> {
  public readonly name = "market.indicators.get";
  public readonly version = 1;
  public readonly displayName = "Get Technical Indicators";
  public readonly description = "Fetch technical indicator snapshot (RSI, EMA20, EMA50, MACD, ATR, Bollinger Bands) for a symbol";
  public readonly category = "TECHNICAL_INDICATOR" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().describe("Symbol name e.g. BTC-USDT"),
    interval: z.string().optional().default("1h").describe("Indicator timeframe e.g. 15m, 1h, 4h, 1d"),
  });

  public readonly outputSchema = z.object({
    symbol: z.string(),
    interval: z.string(),
    rsi: z.number(),
    ema20: z.number(),
    ema50: z.number(),
    macdHistogram: z.number(),
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

  public async execute(input: { symbol: string; interval?: string }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    await Promise.resolve();
    return {
      symbol: input.symbol,
      interval: input.interval || "1h",
      rsi: 58.4,
      ema20: 94800,
      ema50: 93500,
      macdHistogram: 120.5,
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class MarketFundingGetTool implements ToolDefinition<{ symbol: string }, Record<string, unknown>> {
  public readonly name = "market.funding.get";
  public readonly version = 1;
  public readonly displayName = "Get Funding Rate";
  public readonly description = "Fetch current and predicted perpetual futures funding rate for a symbol";
  public readonly category = "MARKET_DATA" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().describe("Symbol name e.g. BTC-USDT"),
  });

  public readonly outputSchema = z.object({
    symbol: z.string(),
    fundingRate: z.string(),
    predictedRate: z.string().optional(),
    nextFundingTime: z.string(),
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

  public async execute(input: { symbol: string }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    await Promise.resolve();
    return {
      symbol: input.symbol,
      fundingRate: "0.00010000",
      predictedRate: "0.00012000",
      nextFundingTime: new Date(Date.now() + 14400000).toISOString(),
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class MarketOpenInterestGetTool implements ToolDefinition<{ symbol: string }, Record<string, unknown>> {
  public readonly name = "market.open_interest.get";
  public readonly version = 1;
  public readonly displayName = "Get Open Interest";
  public readonly description = "Fetch open interest total contracts and USD value for a perpetual futures contract";
  public readonly category = "MARKET_DATA" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().describe("Symbol name e.g. BTC-USDT"),
  });

  public readonly outputSchema = z.object({
    symbol: z.string(),
    openInterest: z.string(),
    openInterestUsd: z.string(),
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

  public async execute(input: { symbol: string }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    await Promise.resolve();
    return {
      symbol: input.symbol,
      openInterest: "45280.5",
      openInterestUsd: "4320950000.00",
      timestamp: new Date().toISOString(),
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class MarketOrderBookGetTool implements ToolDefinition<{ symbol: string; depth?: number }, Record<string, unknown>> {
  public readonly name = "market.order_book.get";
  public readonly version = 1;
  public readonly displayName = "Get Order Book Depth";
  public readonly description = "Fetch top bid/ask order book depth for a cryptocurrency symbol";
  public readonly category = "MARKET_DATA" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().describe("Symbol name e.g. BTC-USDT"),
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

  public async execute(input: { symbol: string; depth?: number }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    await Promise.resolve();
    return {
      symbol: input.symbol,
      depth: input.depth || 10,
      bids: [["95420.00", "2.45"], ["95419.50", "5.10"]],
      asks: [["95420.50", "1.80"], ["95421.00", "3.25"]],
      timestamp: new Date().toISOString(),
      invocationId: context.invocationId,
    };
  }
}
