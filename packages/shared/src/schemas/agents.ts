import { z } from 'zod';

export const AgentTypeSchema = z.enum([
  'MARKET_ANALYST',
  'TECHNICAL_ANALYST',
  'NEWS_ANALYST',
  'SOCIAL_ANALYST',
  'MACRO_ANALYST',
  'ON_CHAIN_ANALYST',
  'RISK_REVIEWER',
  'DECISION_SYNTHESIZER',
  'JUDGE',
  'MEMORY_AGENT',
  'PERFORMANCE',
  'REFLECTION',
  'SYSTEM_DIAGNOSTIC',
]);
export type AgentType = z.infer<typeof AgentTypeSchema>;

export const AgentRunStatusSchema = z.enum([
  'CREATED',
  'QUEUED',
  'PREPARING_CONTEXT',
  'READY',
  'RUNNING',
  'WAITING_FOR_TOOL',
  'PROCESSING_TOOL_RESULT',
  'VALIDATING_OUTPUT',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'FAILED',
  'TIMED_OUT',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'REJECTED',
]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

export const AgentInvocationSourceSchema = z.enum([
  'USER_MANUAL',
  'INTERNAL_SERVICE',
  'SYSTEM_TEST',
  'REPLAY',
  'FUTURE_SCHEDULED',
  'FUTURE_EVENT_DRIVEN',
]);
export type AgentInvocationSource = z.infer<typeof AgentInvocationSourceSchema>;

export const AgentHealthStatusSchema = z.enum([
  'HEALTHY',
  'DEGRADED',
  'UNHEALTHY',
  'UNKNOWN',
  'INITIALIZING',
  'OFFLINE'
]);
export type AgentHealthStatus = z.infer<typeof AgentHealthStatusSchema>;

export const AgentDefinitionDtoSchema = z.object({
  name: z.string().optional(),
  type: AgentTypeSchema,
  version: z.number().int().nonnegative(),
  displayName: z.string(),
  description: z.string(),
  status: z.enum(['ACTIVE', 'DISABLED', 'DEPRECATED', 'EXPERIMENTAL', 'UNAVAILABLE']),
  promptId: z.string(),
  promptVersion: z.number().int().nonnegative(),
  allowedTools: z.array(z.string()),
  capabilities: z.array(z.string()),
  health: AgentHealthStatusSchema.optional(),
  avgLatencyMs: z.number().optional(),
  successRatePct: z.number().optional(),
});
export type AgentDefinitionDto = z.infer<typeof AgentDefinitionDtoSchema>;

export const AgentRunDtoSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  agentType: AgentTypeSchema,
  agentVersion: z.number().int(),
  status: AgentRunStatusSchema,
  invocationSource: AgentInvocationSourceSchema,
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  estimatedCost: z.number(),
  toolCallCount: z.number(),
  toolRoundCount: z.number(),
  retryCount: z.number(),
  failureCode: z.string().nullable().optional(),
  safeFailureMessage: z.string().nullable().optional(),
  traceId: z.string().nullable().optional(),
  correlationId: z.string().nullable().optional(),
  parentRunId: z.string().uuid().nullable().optional(),
  replayOfRunId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type AgentRunDto = z.infer<typeof AgentRunDtoSchema>;

export const AgentRunTransitionDtoSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  fromState: AgentRunStatusSchema,
  toState: AgentRunStatusSchema,
  reason: z.string(),
  actor: z.string(),
  createdAt: z.string().datetime(),
});
export type AgentRunTransitionDto = z.infer<typeof AgentRunTransitionDtoSchema>;

export const AgentContextSnapshotDtoSchema = z.object({
  id: z.string().uuid(),
  symbol: z.string().nullable().optional(),
  timeframe: z.string().nullable().optional(),
  sourceDataCutoff: z.string().datetime(),
  schemaVersion: z.number().int(),
  contextHash: z.string(),
  tokenEstimate: z.number().int(),
  createdAt: z.string().datetime(),
});
export type AgentContextSnapshotDto = z.infer<typeof AgentContextSnapshotDtoSchema>;

export const AgentHealthDtoSchema = z.object({
  agentType: AgentTypeSchema,
  version: z.number().int(),
  status: z.enum(['ACTIVE', 'DISABLED', 'DEPRECATED', 'EXPERIMENTAL', 'UNAVAILABLE']),
  healthStatus: AgentHealthStatusSchema,
  reasons: z.array(z.string()),
  avgLatencyMs: z.number(),
  successRatePct: z.number(),
  totalRuns: z.number().int(),
  activeRuns: z.number().int(),
});
export type AgentHealthDto = z.infer<typeof AgentHealthDtoSchema>;

export const DiagnosticAgentOutputSchema = z.object({
  summary: z.string(),
  observations: z.array(z.string()),
  dataQuality: z.string(),
  usedTools: z.array(z.string()),
  generatedAt: z.string().datetime(),
});
export type DiagnosticAgentOutput = z.infer<typeof DiagnosticAgentOutputSchema>;

export const MarketAgentProviderSchema = z.enum([
  'BINANCE_FUTURES',
  'OKX_FUTURES',
]);

export const MarketAgentIntervalSchema = z.enum(['1m', '5m', '15m', '1h']);

export const MarketAgentInputSchema = z
  .object({
    symbol: z.enum(['BTC-USDT', 'ETH-USDT']),
    provider: MarketAgentProviderSchema,
    interval: MarketAgentIntervalSchema,
    lookbackCandles: z.number().int().min(1).max(500).default(100),
  })
  .strict();
export type MarketAgentInput = z.infer<typeof MarketAgentInputSchema>;

export const MarketAgentToolNameSchema = z.enum([
  'market.ticker.get',
  'market.candles.list',
  'market.indicators.get',
  'market.funding.get',
  'market.open_interest.get',
  'market.order_book.get',
]);

export const MarketAgentOutputSchema = z
  .object({
    summary: z.string().min(1),
    trend: z
      .object({
        direction: z.enum(['UP', 'DOWN', 'SIDEWAYS']),
        strength: z.enum(['WEAK', 'MODERATE', 'STRONG']),
      })
      .strict(),
    volatility: z
      .object({
        level: z.enum(['LOW', 'MEDIUM', 'HIGH']),
        atr: z.string().optional(),
      })
      .strict(),
    liquidity: z
      .object({
        bidAskSpread: z.string().optional(),
        depthImbalance: z
          .enum(['BUY_HEAVY', 'SELL_HEAVY', 'BALANCED'])
          .optional(),
      })
      .strict(),
    derivatives: z
      .object({
        fundingRate: z.string().optional(),
        fundingTrend: z
          .enum(['INCREASING', 'DECREASING', 'STABLE'])
          .optional(),
        openInterest: z.string().optional(),
        oiTrend: z
          .enum(['INCREASING', 'DECREASING', 'STABLE'])
          .optional(),
      })
      .strict(),
    anomalies: z.array(z.string()),
    dataQuality: z.enum(['GOOD', 'PARTIAL', 'INSUFFICIENT']),
    usedTools: z.array(MarketAgentToolNameSchema).max(6),
    generatedAt: z.string().datetime(),
  })
  .strict();
export type MarketAgentOutput = z.infer<typeof MarketAgentOutputSchema>;

export const TechnicalAgentInputSchema = z
  .object({
    symbol: z.enum(['BTC-USDT', 'ETH-USDT']),
    provider: MarketAgentProviderSchema,
    interval: MarketAgentIntervalSchema,
    lookbackCandles: z.number().int().min(1).max(500).default(150),
  })
  .strict();
export type TechnicalAgentInput = z.infer<typeof TechnicalAgentInputSchema>;

export const TechnicalAgentToolNameSchema = z.enum([
  'market.candles.list',
  'market.indicators.get',
]);

export const TechnicalAgentOutputSchema = z
  .object({
    summary: z.string().min(1),
    trend: z
      .object({
        direction: z.enum(['UP', 'DOWN', 'SIDEWAYS']),
        strength: z.enum(['WEAK', 'MODERATE', 'STRONG']),
      })
      .strict(),
    momentum: z
      .object({
        rsi: z.string(),
        rsiState: z.enum(['OVERBOUGHT', 'OVERSOLD', 'NEUTRAL']),
        macd: z
          .object({
            trend: z.enum(['BULLISH', 'BEARISH', 'NEUTRAL']),
            crossover: z.enum(['BULLISH', 'BEARISH', 'NONE']).optional(),
          })
          .strict(),
      })
      .strict(),
    movingAverages: z
      .object({
        alignment: z.enum(['BULLISH', 'BEARISH', 'MIXED']),
        pricePosition: z.enum(['ABOVE', 'BELOW', 'INSIDE']),
      })
      .strict(),
    volatility: z
      .object({
        atr: z.string().optional(),
        bollinger: z
          .object({
            position: z.enum(['UPPER', 'MIDDLE', 'LOWER']),
            squeeze: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    structure: z
      .object({
        marketStructure: z.enum(['HH_HL', 'LH_LL', 'RANGE']),
        breakout: z.boolean().optional(),
      })
      .strict(),
    divergence: z
      .object({
        rsiDivergence: z.enum(['BULLISH', 'BEARISH', 'NONE']).optional(),
        macdDivergence: z.enum(['BULLISH', 'BEARISH', 'NONE']).optional(),
      })
      .strict(),
    signals: z.array(z.string()),
    dataQuality: z.enum(['GOOD', 'PARTIAL', 'INSUFFICIENT']),
    usedTools: z.array(TechnicalAgentToolNameSchema).max(2),
    generatedAt: z.string().datetime(),
  })
  .strict();
export type TechnicalAgentOutput = z.infer<typeof TechnicalAgentOutputSchema>;

export const AgentRunFilterDtoSchema = z.object({
  agentType: AgentTypeSchema.optional(),
  status: AgentRunStatusSchema.optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  invocationSource: AgentInvocationSourceSchema.optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  parentRunId: z.string().uuid().optional(),
  replayOfRunId: z.string().uuid().optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  sort: z.enum(['asc', 'desc']).optional(),
});
export type AgentRunFilterDto = z.infer<typeof AgentRunFilterDtoSchema>;
