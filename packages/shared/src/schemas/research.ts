import { z } from 'zod';

export const ResearchBacktestRequestSchema = z.object({
  provider: z.enum(['BINANCE_FUTURES', 'OKX_FUTURES']),
  symbol: z.string().min(1),
  interval: z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d']),
  lookbackCandles: z.number().int().min(10).max(5000).default(200),
  initialBalance: z.number().positive().default(10000),
  leverage: z.number().positive().max(20).default(2),
  riskPerTrade: z.number().positive().max(1).default(0.01),
  riskRewardRatio: z.number().positive().max(10).default(2),
  strategyName: z.string().optional(),
});

export const ResearchValidationRequestSchema = z.object({
  provider: z.enum(['BINANCE_FUTURES', 'OKX_FUTURES']),
  symbol: z.string().min(1),
  interval: z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d']),
  lookbackCandles: z.number().int().min(20).max(5000).default(300),
  initialBalance: z.number().positive().default(10000),
  trainWindow: z.number().int().min(20).max(1000).default(120),
  validationWindow: z.number().int().min(10).max(500).default(30),
});

export const ResearchBacktestTradeSchema = z.object({
  entryTime: z.string(),
  exitTime: z.string(),
  entryPrice: z.number(),
  exitPrice: z.number(),
  pnl: z.number(),
  holdingTime: z.number(),
  maxFavorableExcursion: z.number(),
  maxAdverseExcursion: z.number(),
  riskReward: z.number(),
  expectedValue: z.number(),
  tradeQualityScore: z.number(),
});

export const ResearchMetricsSchema = z.object({
  totalReturn: z.number(),
  annualizedReturn: z.number(),
  monthlyReturn: z.number(),
  winRate: z.number(),
  profitFactor: z.number(),
  expectancy: z.number(),
  averageWin: z.number(),
  averageLoss: z.number(),
  averageHoldingTime: z.number(),
  maxDrawdown: z.number(),
  recoveryFactor: z.number(),
  sharpeRatio: z.number(),
  sortinoRatio: z.number(),
  calmarRatio: z.number(),
  ulcerIndex: z.number(),
  exposureTime: z.number(),
  tradeFrequency: z.number(),
  averageDailyTrades: z.number(),
});

export const ResearchBacktestSummarySchema = z.object({
  strategyName: z.string(),
  provider: z.enum(['BINANCE_FUTURES', 'OKX_FUTURES']),
  symbol: z.string(),
  interval: z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d']),
  trades: z.array(ResearchBacktestTradeSchema),
  metrics: ResearchMetricsSchema,
  equityCurve: z.array(z.object({ timestamp: z.string(), equity: z.number() })),
});

export const ResearchMonteCarloSummarySchema = z.object({
  probabilityOfProfit: z.number(),
  expectedDrawdown: z.number(),
  worstDrawdown: z.number(),
  confidenceInterval95: z.tuple([z.number(), z.number()]),
  probabilityOfRuin: z.number(),
  capitalSurvivalRate: z.number(),
});

export const ResearchWalkForwardSummarySchema = z.object({
  windows: z.array(z.object({
    trainStart: z.string(),
    trainEnd: z.string(),
    validationStart: z.string(),
    validationEnd: z.string(),
    return: z.number(),
    drawdown: z.number(),
  })),
  stable: z.boolean(),
  averageReturn: z.number(),
});
