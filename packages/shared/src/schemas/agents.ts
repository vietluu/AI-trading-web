import { z } from 'zod';

export const AgentTypeSchema = z.enum([
  'MARKET_ANALYST',
  'TECHNICAL_ANALYST',
  'NEWS_ANALYST',
  'SENTIMENT_ANALYST',
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
    symbol: z.string().min(1).max(32),
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
        volumeProfile: z.boolean().optional(),
        spread: z.string().optional(),
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
    symbol: z.string().min(1).max(32),
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
        marketStructure: z.enum(['HH_HL', 'LH_LL', 'LL_LH', 'RANGE']),
        breakout: z.boolean().optional(),
      })
      .strict(),
    divergence: z
      .object({
        rsiDivergence: z.enum(['BULLISH', 'BEARISH', 'NONE']).optional(),
        macdDivergence: z.enum(['BULLISH', 'BEARISH', 'NONE']).optional(),
      })
      .strict()
      .default({}),
    signals: z.array(z.string()),
    dataQuality: z.enum(['GOOD', 'PARTIAL', 'INSUFFICIENT']),
    usedTools: z.array(TechnicalAgentToolNameSchema).max(2),
    generatedAt: z.string().datetime(),
  })
  .strict();
export type TechnicalAgentOutput = z.infer<typeof TechnicalAgentOutputSchema>;


export const NewsSentimentInputSchema = z
  .object({
    symbol: z.string().min(1).max(32).optional(),
    lookbackHours: z.number().int().min(1).max(24).default(6),
    maxItems: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type NewsSentimentInput = z.infer<typeof NewsSentimentInputSchema>;

export const NewsAgentToolNameSchema = z.enum([
  'news.articles.list',
  'news.article.get',
  'news.high_importance.list',
]);

export const NewsAgentOutputSchema = z
  .object({
    summary: z.string().min(1),
    impact: z
      .object({
        level: z.enum(['LOW', 'MEDIUM', 'HIGH']),
        direction: z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL']),
      })
      .strict(),
    keyEvents: z.array(
      z
        .object({
          title: z.string().min(1),
          impact: z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL']),
          importance: z.number().min(0).max(100),
        })
        .strict(),
    ),
    themes: z.array(z.string()),
    riskSignals: z.array(z.string()),
    dataQuality: z.enum(['GOOD', 'PARTIAL', 'INSUFFICIENT']),
    usedTools: z.array(NewsAgentToolNameSchema).max(3),
    generatedAt: z.string().datetime(),
  })
  .strict();
export type NewsAgentOutput = z.infer<typeof NewsAgentOutputSchema>;

export const SentimentAgentToolNameSchema = z.enum([
  'sentiment.market.get',
  'social.posts.list',
]);

export const SentimentAgentOutputSchema = z
  .object({
    summary: z.string().min(1),
    sentiment: z
      .object({
        overall: z.enum(['BULLISH', 'BEARISH', 'NEUTRAL']),
        intensity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
      })
      .strict(),
    crowdBehavior: z
      .object({
        fomo: z.boolean(),
        panic: z.boolean(),
        euphoria: z.boolean(),
      })
      .strict(),
    sources: z
      .object({
        social: z.string().optional(),
        marketSentimentIndex: z.string().optional(),
      })
      .strict(),
    anomalies: z.array(z.string()),
    dataQuality: z.enum(['GOOD', 'PARTIAL', 'INSUFFICIENT']),
    usedTools: z.array(SentimentAgentToolNameSchema).max(2),
    generatedAt: z.string().datetime(),
  })
  .strict();
export type SentimentAgentOutput = z.infer<typeof SentimentAgentOutputSchema>;

export const AgentDataQualitySchema = z.enum([
  'GOOD',
  'PARTIAL',
  'INSUFFICIENT',
]);
export type AgentDataQuality = z.infer<typeof AgentDataQualitySchema>;

export const MacroAgentInputSchema = z
  .object({
    lookbackHours: z.number().int().min(1).max(720).default(24),
  })
  .strict();
export type MacroAgentInput = z.infer<typeof MacroAgentInputSchema>;

export const MacroAgentOutputSchema = z
  .object({
    summary: z.string().min(1),
    macroTrend: z.enum(['RISK_ON', 'RISK_OFF', 'NEUTRAL']),
    keyEvents: z.array(z.string()),
    riskFactors: z.array(z.string()),
    dataQuality: AgentDataQualitySchema,
    generatedAt: z.string().datetime(),
  })
  .strict();
export type MacroAgentOutput = z.infer<typeof MacroAgentOutputSchema>;

export const OnChainAgentInputSchema = z
  .object({
    symbol: z.string().min(1).max(32).optional(),
    lookbackHours: z.number().int().min(1).max(720).default(24),
  })
  .strict();
export type OnChainAgentInput = z.infer<typeof OnChainAgentInputSchema>;

export const OnChainAgentOutputSchema = z
  .object({
    summary: z.string().min(1),
    activity: z.enum(['HIGH', 'NORMAL', 'LOW']),
    flows: z
      .object({
        exchangeInflow: z.string().optional(),
        exchangeOutflow: z.string().optional(),
      })
      .strict(),
    signals: z.array(z.string()),
    dataQuality: AgentDataQualitySchema,
    generatedAt: z.string().datetime(),
  })
  .strict();
export type OnChainAgentOutput = z.infer<typeof OnChainAgentOutputSchema>;

export const FusionInputSchema = z
  .object({
    market: MarketAgentOutputSchema,
    technical: TechnicalAgentOutputSchema,
    news: NewsAgentOutputSchema,
    sentiment: SentimentAgentOutputSchema,
    macro: MacroAgentOutputSchema,
    onchain: OnChainAgentOutputSchema,
  })
  .strict();
export type FusionInput = z.infer<typeof FusionInputSchema>;

const supportedSymbolPattern = /^[A-Z0-9]{2,12}-[A-Z0-9]{2,12}$/;

export const FusionRunInputSchema = z
  .object({
    symbol: z.string().min(1).max(32).regex(supportedSymbolPattern),
    provider: MarketAgentProviderSchema,
    interval: MarketAgentIntervalSchema,
    lookbackCandles: z.number().int().min(1).max(500).default(150),
    lookbackHours: z.number().int().min(1).max(24).default(6),
    maxItems: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type FusionRunInput = z.infer<typeof FusionRunInputSchema>;

export const FusionOutputSchema = z
  .object({
    summary: z.string().min(1),
    combinedAnalysis: z
      .object({
        market: z.string(),
        technical: z.string(),
        news: z.string(),
        sentiment: z.string(),
        macro: z.string(),
        onchain: z.string(),
      })
      .strict(),
    overallBias: z.enum(['BULLISH', 'BEARISH', 'NEUTRAL']),
    confidence: z.number().min(0).max(100),
    conflicts: z.array(z.string()),
    dataQuality: AgentDataQualitySchema,
    generatedAt: z.string().datetime(),
  })
  .strict();
export type FusionOutput = z.infer<typeof FusionOutputSchema>;

export const DecisionSchema = z.enum(['LONG', 'SHORT', 'WAIT']);
export type Decision = z.infer<typeof DecisionSchema>;

export const MarketRegimeSchema = z
  .object({
    type: z.enum(['TRENDING', 'RANGING', 'HIGH_VOLATILITY']),
  })
  .strict();
export type MarketRegime = z.infer<typeof MarketRegimeSchema>;

export const DecisionWeightingSchema = z
  .object({
    market: z.number().min(0).max(100),
    technical: z.number().min(0).max(100),
    news: z.number().min(0).max(100),
    sentiment: z.number().min(0).max(100),
    macro: z.number().min(0).max(100),
    onchain: z.number().min(0).max(100),
  })
  .strict();

export const DecisionInputSchema = z
  .object({
    symbol: z.string().min(1),
    fusionOutput: FusionOutputSchema,
    market: MarketAgentOutputSchema.optional(),
    technical: TechnicalAgentOutputSchema.optional(),
    news: NewsAgentOutputSchema.optional(),
    sentiment: SentimentAgentOutputSchema.optional(),
    macro: MacroAgentOutputSchema.optional(),
    onchain: OnChainAgentOutputSchema.optional(),
  })
  .strict();
export type DecisionInput = z.infer<typeof DecisionInputSchema>;

export const DecisionRunInputSchema = FusionRunInputSchema;
export type DecisionRunInput = z.infer<typeof DecisionRunInputSchema>;

export const DecisionOutputSchema = z
  .object({
    decision: DecisionSchema,
    confidence: z.number().min(0).max(100),
    confidenceKind: z.literal('COMPOSITE_SCORE').optional(),
    confidenceCalibration: z.object({
      status: z.enum(['CALIBRATED', 'INSUFFICIENT_HISTORY']),
      rawScore: z.number().min(0).max(100),
      empiricalProbability: z.number().min(0).max(1).nullable(),
      sampleSize: z.number().int().nonnegative(),
      bucketSampleSize: z.number().int().nonnegative(),
      brierScore: z.number().min(0).max(1).nullable(),
      scope: z.enum([
        'EXACT',
        'STRATEGY_CONTEXT',
        'STRATEGY_TIMEFRAME',
        'USER_GLOBAL',
        'NONE',
      ]).optional(),
      fallbackUsed: z.boolean().optional(),
    }).strict().optional(),
    learningConfiguration: z.object({
      version: z.number().int().positive(),
      stage: z.enum(['LIVE', 'CANARY']),
    }).strict().optional(),
    reasoning: z.string().min(1),
    signals: z
      .object({
        bullishFactors: z.array(z.string()),
        bearishFactors: z.array(z.string()),
      })
      .strict(),
    risks: z.array(z.string()),
    agreementScore: z.number().min(0).max(100),
    dataQuality: AgentDataQualitySchema,
    regime: MarketRegimeSchema,
    weighting: DecisionWeightingSchema,
    overrides: z.array(z.string()),
    volatilityAdjustment: z.number().min(-100).max(0),
    conflictLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    opportunityScore: z.number().min(0).max(100),
    expectedWinProbability: z.number().min(0).max(1),
    expectedReward: z.number().min(0),
    expectedLoss: z.number().min(0),
    expectedValue: z.number(),
    profitFactorEstimate: z.number().min(0),
    riskScore: z.number().min(0).max(100),
    adaptiveThreshold: z.number().min(0).max(100),
    calibrationAdjustment: z.number(),
    executionCost: z.number().min(0),
    generatedAt: z.string().datetime(),
  })
  .strict();
export type DecisionOutput = z.infer<typeof DecisionOutputSchema>;
export const DecisionOutputProSchema = DecisionOutputSchema;
export type DecisionOutputPro = DecisionOutput;

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
