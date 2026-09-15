import { z } from 'zod';
import {
  CanonicalSetupSchema,
  EntryActionSchema,
  ExecutionContextSchema,
} from './pipeline.js';

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

export const AgentDataQualitySchema = z.enum([
  'GOOD',
  'PARTIAL',
  'INSUFFICIENT',
]);
export type AgentDataQuality = z.infer<typeof AgentDataQualitySchema>;

export const SourceCoverageLevelSchema = z.enum(['FULL', 'PARTIAL', 'EMPTY']);
export type SourceCoverageLevel = z.infer<typeof SourceCoverageLevelSchema>;

export const AgentProvenanceSchema = z
  .object({
    provider: z.string(),
    sourceTimestamp: z.string().datetime().optional(),
    observationAgeMs: z.number().nonnegative().optional(),
    coverage: SourceCoverageLevelSchema,
    unavailableFields: z.array(z.string()).default([]),
    dataQualityReason: z.string().optional(),
  })
  .strict();
export type AgentProvenance = z.infer<typeof AgentProvenanceSchema>;

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
    dataQuality: AgentDataQualitySchema,
    usedTools: z.array(MarketAgentToolNameSchema).max(6),
    provenance: AgentProvenanceSchema.optional(),
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
    dataQuality: AgentDataQualitySchema,
    usedTools: z.array(TechnicalAgentToolNameSchema).max(2),
    provenance: AgentProvenanceSchema.optional(),
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
    dataQuality: AgentDataQualitySchema,
    usedTools: z.array(NewsAgentToolNameSchema).max(3),
    provenance: AgentProvenanceSchema.optional(),
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
    dataQuality: AgentDataQualitySchema,
    usedTools: z.array(SentimentAgentToolNameSchema).max(2),
    provenance: AgentProvenanceSchema.optional(),
    generatedAt: z.string().datetime(),
  })
  .strict();
export type SentimentAgentOutput = z.infer<typeof SentimentAgentOutputSchema>;

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
    provenance: AgentProvenanceSchema.optional(),
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
    provenance: AgentProvenanceSchema.optional(),
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

export const DetailedRegimeTypeSchema = z.enum([
  'TRENDING_BULL',
  'TRENDING_BEAR',
  'RANGING_CONSOLIDATION',
  'VOLATILE_LIQUIDITY_EXPANSION',
  'PRE_BREAKOUT_ACCUMULATION',
]);
export type DetailedRegimeType = z.infer<typeof DetailedRegimeTypeSchema>;

export const TradingScenarioSchema = z
  .object({
    id: z.string(),
    type: z.enum(['PRIMARY', 'CONTINGENCY', 'INVALIDATION']),
    direction: DecisionSchema,
    probability: z.number().min(0).max(1),
    triggerCondition: z.string(),
    priceTarget: z.number().optional(),
    invalidationPrice: z.number().optional(),
    rationale: z.string(),
  })
  .strict();
export type TradingScenario = z.infer<typeof TradingScenarioSchema>;

export const MarketRegimeSchema = z
  .object({
    type: z.enum(['TRENDING', 'RANGING', 'HIGH_VOLATILITY']),
    detailed: DetailedRegimeTypeSchema.optional(),
    playbook: z.string().optional(),
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

export const ExecutionEvidenceScoreSchema = z
  .object({
    signalStrength: z.number().min(0).max(100),
    estimatedWinProbability: z.number().min(0).max(1).optional(),
    expectedNetR: z.number().optional(),
    calibrationQuality: z.enum(['RELIABLE', 'UNRELIABLE', 'INSUFFICIENT']),
  })
  .strict();
export type ExecutionEvidenceScore = z.infer<typeof ExecutionEvidenceScoreSchema>;

export const ExecutableThesisSchema = z
  .object({
    action: EntryActionSchema,
    setup: CanonicalSetupSchema,
    entryZone: z.object({ lower: z.number(), upper: z.number() }).strict().optional(),
    trigger: z.object({
      kind: z.string().min(1),
      confirmed: z.boolean(),
      observedAt: z.string().datetime(),
    }).strict(),
    invalidation: z.object({ price: z.number(), reason: z.string().min(1) }).strict().optional(),
    targets: z.array(z.object({
      price: z.number(),
      fraction: z.number().positive().max(1),
      role: z.string().min(1),
    }).strict()),
    maximumChaseDistanceAtr: z.number().nonnegative(),
    expectedNetR: z.number().optional(),
    evidenceFor: z.array(z.string()),
    evidenceAgainst: z.array(z.string()),
    whyEntryIsNotLate: z.string().min(1).optional(),
    nextActionCondition: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'WAIT') {
      if (!value.nextActionCondition) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nextActionCondition'],
          message: 'WAIT thesis requires a next action condition',
        });
      }
      return;
    }

    for (const field of ['entryZone', 'invalidation', 'whyEntryIsNotLate'] as const) {
      if (!value[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${value.action} thesis requires ${field}`,
        });
      }
    }
    if (value.targets.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targets'],
        message: `${value.action} thesis requires at least one target`,
      });
    }
  });
export type ExecutableThesis = z.infer<typeof ExecutableThesisSchema>;

export const DecisionOutputSchema = z
  .object({
    decision: DecisionSchema,
    confidence: z.number().min(0).max(100),
    confidenceKind: z.literal('COMPOSITE_SCORE').optional(),
    calibrationBlockingReasons: z.array(z.string()).optional(),
    executionEvidence: ExecutionEvidenceScoreSchema.optional(),
    confidenceCalibration: z.object({
      status: z.enum(['CALIBRATED', 'INSUFFICIENT_HISTORY']),
      rawScore: z.number().min(0).max(100),
      empiricalProbability: z.number().min(0).max(1).nullable(),
      sampleSize: z.number().int().nonnegative(),
      bucketSampleSize: z.number().int().nonnegative(),
      brierScore: z.number().min(0).max(1).nullable(),
      scope: z.enum([
        'EXACT',
        'BLENDED',
        'STRATEGY_CONTEXT',
        'STRATEGY_TIMEFRAME',
        'USER_GLOBAL',
        'NONE',
      ]).optional(),
      fallbackUsed: z.boolean().optional(),
      hardGateEligible: z.boolean().optional(),
      exactProbability: z.number().min(0).max(1).optional(),
      fallbackProbability: z.number().min(0).max(1).optional(),
      fallbackScope: z.enum([
        'STRATEGY_CONTEXT',
        'STRATEGY_TIMEFRAME',
        'USER_GLOBAL',
      ]).optional(),
      exactWeight: z.number().min(0).max(1).optional(),
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
    directionalAgreement: z.number().min(0).max(100).optional(),
    evidenceCoverage: z.number().min(0).max(100).optional(),
    coreDataQuality: AgentDataQualitySchema.optional(),
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
    // Historic stored decisions predate executable playbooks. New Decision
    // service output always supplies both fields; parsing legacy records stays
    // backward-compatible until their migration is complete.
    executionContext: ExecutionContextSchema.optional(),
    thesis: ExecutableThesisSchema.optional(),
    decisionSource: z.enum(['AI', 'RULES', 'AI_WITH_RULES_FALLBACK']).optional(),
    scenarios: z.array(TradingScenarioSchema).optional(),
    regimeDetailed: DetailedRegimeTypeSchema.optional(),
    anticipatorySignals: z.object({
      squeeze: z.object({
        active: z.boolean(),
        intensity: z.number().min(0).max(100),
        duration: z.number().int().min(0),
        breakoutBias: z.enum(['BULLISH', 'BEARISH', 'NEUTRAL']),
        breakoutProbability: z.number().min(0).max(100),
      }).optional(),
      liquiditySweep: z.object({
        detected: z.boolean(),
        direction: z.enum(['BULLISH_SWEEP', 'BEARISH_SWEEP']).nullable(),
        confidence: z.number().min(0).max(100),
      }).optional(),
      derivativesImbalance: z.object({
        squeezeProbability: z.number().min(0).max(100),
        squeezeDirection: z.enum(['LONG_SQUEEZE', 'SHORT_SQUEEZE', 'NONE']),
        fundingExtreme: z.enum(['EXTREME_NEGATIVE', 'EXTREME_POSITIVE', 'NORMAL']),
      }).optional(),
    }).optional(),
    reflection: z.object({
      reasoning: z.string(),
      contrarianArguments: z.array(z.string()),
      trapProbability: z.number().min(0).max(100),
      overrideReason: z.string().optional(),
    }).optional(),
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

export const OpportunityStateSchema = z.enum([
  'OBSERVING',
  'WATCHING',
  'PROBE_READY',
  'PROBE_OPEN',
  'CONFIRMED',
  'POSITION_OPEN',
  'INVALIDATED',
  'EXPIRED',
  'TOO_LATE',
]);
export type OpportunityState = z.infer<typeof OpportunityStateSchema>;

export const EvidenceRefSchema = z
  .object({
    snapshotField: z.string().min(1),
    source: z.string().min(1),
    sourceTimestamp: z.string().datetime(),
    calculationVersion: z.number().int().nonnegative(),
  })
  .strict();
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

const availableEvidenceMetadata = {
  coverage: z.literal('AVAILABLE'),
  freshness: z.enum(['FRESH', 'STALE']),
  observationAgeMs: z.number().int().nonnegative(),
  freshnessThresholdMs: z.number().int().nonnegative(),
  sourceTimestamp: z.string().datetime(),
  calculationVersion: z.number().int().nonnegative(),
  evidence: z.array(EvidenceRefSchema).min(1),
};

const UnavailableEvidenceSchema = z
  .object({
    coverage: z.literal('UNAVAILABLE'),
    freshness: z.literal('UNAVAILABLE'),
    observationAgeMs: z.null(),
    unavailableFields: z.array(z.string().min(1)).min(1),
    reason: z.string().min(1),
  })
  .strict();

const LiquiditySweepEvidenceSchema = z.union([
  UnavailableEvidenceSchema,
  z
    .object({
      ...availableEvidenceMetadata,
      detected: z.boolean(),
      direction: z.enum(['BULLISH_SWEEP', 'BEARISH_SWEEP']).nullable(),
      sweepZone: z
        .object({
          price: z.number().positive(),
          type: z.enum(['SWING_HIGH', 'SWING_LOW', 'EQUAL_HIGHS', 'EQUAL_LOWS']),
        })
        .strict()
        .nullable(),
      penetration: z.number().nonnegative(),
      reclaimed: z.boolean(),
    })
    .strict()
    .superRefine((sweep, ctx) => {
      if (sweep.detected && (sweep.direction === null || sweep.sweepZone === null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'detected liquidity sweeps require a direction and sweep zone',
        });
      }
      if (!sweep.detected && (sweep.direction !== null || sweep.sweepZone !== null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'no-signal liquidity sweeps must not include a direction or sweep zone',
        });
      }
    }),
]);

const PriceStructureEvidenceSchema = z.union([
  UnavailableEvidenceSchema,
  z
    .object({
      ...availableEvidenceMetadata,
      confirmedPivots: z.array(
        z
          .object({
            kind: z.enum(['HIGH', 'LOW']),
            price: z.number().positive(),
            occurredAt: z.string().datetime(),
            confirmedAt: z.string().datetime(),
          })
          .strict(),
      ),
      rangeBoundaries: z
        .object({
          lower: z.number().positive(),
          upper: z.number().positive(),
        })
        .strict()
        .refine((range) => range.lower < range.upper, {
          message: 'range lower boundary must be below upper boundary',
        }),
      equalHighs: z.array(z.number().positive()),
      equalLows: z.array(z.number().positive()),
      distanceToNearestBoundaryAtr: z.number().nonnegative(),
      invalidationCandidates: z.array(
        z
          .object({
            direction: z.enum(['LONG', 'SHORT']),
            price: z.number().positive(),
            reason: z.string().min(1),
          })
          .strict(),
      ),
      liquiditySweep: LiquiditySweepEvidenceSchema,
    })
    .strict(),
]);

const VolatilityEvidenceSchema = z.union([
  UnavailableEvidenceSchema,
  z
    .object({
      ...availableEvidenceMetadata,
      atr: z.number().positive(),
      atrPercentile: z.number().min(0).max(100),
      squeezeState: z.enum(['SQUEEZING', 'NOT_SQUEEZING']),
      squeezeDurationCandles: z.number().int().nonnegative(),
      compressionSlope: z.number(),
      expansionState: z.enum(['NOT_EXPANDED', 'EXPANDING', 'EXPANDED']),
    })
    .strict(),
]);

const MomentumEvidenceSchema = z.union([
  UnavailableEvidenceSchema,
  z
    .object({
      ...availableEvidenceMetadata,
      rsi: z.number().min(0).max(100),
      macd: z
        .object({
          value: z.number(),
          signal: z.number(),
          histogram: z.number(),
        })
        .strict(),
      pivotOscillators: z.array(
        z
          .object({
            pivotOccurredAt: z.string().datetime(),
            rsi: z.number().min(0).max(100),
            macdHistogram: z.number(),
          })
          .strict(),
      ),
      momentumState: z.enum(['ACCELERATING', 'DECELERATING', 'STABLE']),
    })
    .strict(),
]);

const OrderBookEvidenceSchema = z.union([
  UnavailableEvidenceSchema,
  z
    .object({
      ...availableEvidenceMetadata,
      imbalance: z.number().min(-1).max(1),
    })
    .strict(),
]);

const ParticipationEvidenceSchema = z.union([
  UnavailableEvidenceSchema,
  z
    .object({
      ...availableEvidenceMetadata,
      volumeState: z.enum(['COMPRESSING', 'EXPANDING', 'STABLE']),
      volumeRatio: z.number().nonnegative(),
      orderBook: OrderBookEvidenceSchema,
    })
    .strict(),
]);

const LiquidationEvidenceSchema = z.union([
  UnavailableEvidenceSchema,
  z
    .object({
      ...availableEvidenceMetadata,
      longLiquidations: z.number().nonnegative(),
      shortLiquidations: z.number().nonnegative(),
    })
    .strict(),
]);

const DerivativesImbalanceEvidenceSchema = z.union([
  UnavailableEvidenceSchema,
  z
    .object({
      ...availableEvidenceMetadata,
      fundingExtreme: z.enum([
        'EXTREME_NEGATIVE',
        'EXTREME_POSITIVE',
        'NORMAL',
      ]),
      oiPriceDivergence: z.enum([
        'OI_RISING_PRICE_FLAT',
        'OI_RISING_PRICE_FALLING',
        'OI_FALLING_PRICE_RISING',
        'ALIGNED',
      ]),
      squeezeProbability: z.number().min(0).max(100),
      squeezeDirection: z.enum(['LONG_SQUEEZE', 'SHORT_SQUEEZE', 'NONE']),
      signals: z.array(z.string().min(1)),
    })
    .strict(),
]);

const DerivativesEvidenceSchema = z.union([
  UnavailableEvidenceSchema,
  z
    .object({
      ...availableEvidenceMetadata,
      fundingRate: z.number(),
      fundingRatePercentile: z.number().min(0).max(100),
      openInterest: z.number().nonnegative(),
      openInterestChangePct: z.number(),
      priceOpenInterestDivergence: z.enum([
        'OI_RISING_PRICE_FLAT',
        'OI_RISING_PRICE_FALLING',
        'OI_FALLING_PRICE_RISING',
        'ALIGNED',
      ]),
      liquidationContext: LiquidationEvidenceSchema,
      derivativesImbalance: DerivativesImbalanceEvidenceSchema,
    })
    .strict(),
]);

const ContextObservationSchema = z.union([
  UnavailableEvidenceSchema,
  z
    .object({
      ...availableEvidenceMetadata,
      observations: z.array(
        z
          .object({
            observedAt: z.string().datetime(),
            summary: z.string().min(1),
          })
          .strict(),
      ),
    })
    .strict(),
]);

const ContextEvidenceSchema = z.union([
  UnavailableEvidenceSchema,
  z
    .object({
      ...availableEvidenceMetadata,
      news: ContextObservationSchema,
      sentiment: ContextObservationSchema,
      macro: ContextObservationSchema,
      onChain: ContextObservationSchema,
    })
    .strict(),
]);

const ExecutionEvidenceSchema = z.union([
  UnavailableEvidenceSchema,
  z
    .object({
      ...availableEvidenceMetadata,
      currentPrice: z.number().positive(),
      spread: z.number().nonnegative(),
      estimatedRoundTripCost: z.number().nonnegative(),
      tickSize: z.number().positive(),
      lotSize: z.number().positive(),
      currentExposure: z.number().nonnegative(),
      priceTooFarFromCandidateZones: z.boolean(),
    })
    .strict(),
]);

type SnapshotPath = (string | number)[];

const timestampPropertyPattern = /(?:At|Timestamp)$/u;

function addIssue(
  ctx: z.RefinementCtx,
  path: SnapshotPath,
  message: string,
) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function validateEvidenceMetadata(
  value: unknown,
  cutoffMs: number,
  path: SnapshotPath,
  ctx: z.RefinementCtx,
) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;

  const record = value as Record<string, unknown>;
  if (record.coverage !== 'AVAILABLE') return;

  const sourceTimestamp = record.sourceTimestamp;
  const observationAgeMs = record.observationAgeMs;
  const freshnessThresholdMs = record.freshnessThresholdMs;
  const freshness = record.freshness;
  if (
    typeof sourceTimestamp !== 'string' ||
    typeof observationAgeMs !== 'number' ||
    typeof freshnessThresholdMs !== 'number' ||
    typeof freshness !== 'string'
  ) {
    return;
  }

  const sourceAgeMs = cutoffMs - Date.parse(sourceTimestamp);
  if (observationAgeMs !== sourceAgeMs) {
    addIssue(
      ctx,
      [...path, 'observationAgeMs'],
      'observationAgeMs must equal the source timestamp age at sourceDataCutoff',
    );
  }

  const expectedFreshness =
    observationAgeMs <= freshnessThresholdMs ? 'FRESH' : 'STALE';
  if (freshness !== expectedFreshness) {
    addIssue(
      ctx,
      [...path, 'freshness'],
      'freshness must agree with observationAgeMs and freshnessThresholdMs',
    );
  }
}

function validateEvidenceTree(
  value: unknown,
  cutoffMs: number,
  path: SnapshotPath,
  ctx: z.RefinementCtx,
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateEvidenceTree(item, cutoffMs, [...path, index], ctx),
    );
    return;
  }

  if (value === null || typeof value !== 'object') return;

  validateEvidenceMetadata(value, cutoffMs, path, ctx);
  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    const nestedPath = [...path, key];
    if (timestampPropertyPattern.test(key) && typeof nested === 'string') {
      if (Date.parse(nested) > cutoffMs) {
        addIssue(
          ctx,
          nestedPath,
          'evidence timestamp must not be after sourceDataCutoff',
        );
      }
      continue;
    }
    validateEvidenceTree(nested, cutoffMs, nestedPath, ctx);
  }
}

export function resolveSnapshotPath(snapshot: unknown, path: string): boolean {
  const segments = path.split('.');
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    return false;
  }

  let current: unknown = snapshot;
  for (const segment of segments) {
    const bracketIndex = segment.indexOf('[');
    const property = bracketIndex === -1 ? segment : segment.slice(0, bracketIndex);
    const indexSuffix = bracketIndex === -1 ? '' : segment.slice(bracketIndex);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(property)) {
      return false;
    }

    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, property)
    ) {
      return false;
    }
    current = (current as Record<string, unknown>)[property];

    if (indexSuffix.length > 0) {
      if (!/^(\[\d+\])+$/u.test(indexSuffix)) {
        return false;
      }
      const indexPattern = /\[(\d+)\]/gu;
      for (const indexMatch of indexSuffix.matchAll(indexPattern)) {
        if (!Array.isArray(current)) return false;
        const index = Number(indexMatch[1]);
        if (!Number.isInteger(index) || index < 0 || index >= current.length) {
          return false;
        }
        current = current[index];
      }
    }
  }

  return current !== undefined;
}

function validateEvidenceReferences(
  value: unknown,
  snapshot: unknown,
  calculationVersion: number,
  path: SnapshotPath,
  ctx: z.RefinementCtx,
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateEvidenceReferences(item, snapshot, calculationVersion, [...path, index], ctx),
    );
    return;
  }
  if (value === null || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.evidence)) {
    record.evidence.forEach((reference, index) => {
      if (reference === null || typeof reference !== 'object') return;
      const evidenceRef = reference as Record<string, unknown>;
      const evidencePath = [...path, 'evidence', index];
      if (
        typeof evidenceRef.snapshotField !== 'string' ||
        !resolveSnapshotPath(snapshot, evidenceRef.snapshotField)
      ) {
        addIssue(
          ctx,
          [...evidencePath, 'snapshotField'],
          'evidence reference must resolve to a snapshot field',
        );
      }
      if (evidenceRef.calculationVersion !== calculationVersion) {
        addIssue(
          ctx,
          [...evidencePath, 'calculationVersion'],
          'evidence reference calculationVersion must match snapshot calculationVersion',
        );
      }
    });
  }

  for (const [key, nested] of Object.entries(record)) {
    if (key !== 'evidence') {
      validateEvidenceReferences(nested, snapshot, calculationVersion, [...path, key], ctx);
    }
  }
}

export const AnticipatoryMarketSnapshotSchema = z
  .object({
    symbol: z.string().min(1),
    provider: z.string().min(1),
    timeframe: z.string().min(1),
    sourceDataCutoff: z.string().datetime(),
    schemaVersion: z.number().int().nonnegative(),
    calculationVersion: z.number().int().nonnegative(),
    eligibility: z.discriminatedUnion('status', [
      z.object({ status: z.literal('ELIGIBLE'), reasons: z.tuple([]) }).strict(),
      z
        .object({
          status: z.literal('INELIGIBLE'),
          reasons: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ]),
    structure: PriceStructureEvidenceSchema,
    volatility: VolatilityEvidenceSchema,
    momentum: MomentumEvidenceSchema,
    participation: ParticipationEvidenceSchema,
    derivatives: DerivativesEvidenceSchema,
    context: ContextEvidenceSchema,
    execution: ExecutionEvidenceSchema,
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const cutoffMs = Date.parse(snapshot.sourceDataCutoff);
    validateEvidenceTree(snapshot, cutoffMs, [], ctx);
    validateEvidenceReferences(snapshot, snapshot, snapshot.calculationVersion, [], ctx);

    if (snapshot.structure.coverage === 'AVAILABLE') {
      snapshot.structure.confirmedPivots.forEach((pivot, index) => {
        if (Date.parse(pivot.occurredAt) > Date.parse(pivot.confirmedAt)) {
          addIssue(
            ctx,
            ['structure', 'confirmedPivots', index, 'confirmedAt'],
            'confirmed pivots must occur before they are confirmed',
          );
        }
      });
    }

    const coreEvidenceIsFresh = [
      snapshot.structure,
      snapshot.volatility,
      snapshot.momentum,
      snapshot.participation,
    ].every(
      (section) =>
        section.coverage === 'AVAILABLE' && section.freshness === 'FRESH',
    );
    if (snapshot.eligibility.status === 'ELIGIBLE' && !coreEvidenceIsFresh) {
      addIssue(
        ctx,
        ['eligibility', 'status'],
        'eligible snapshots require fresh available structure, volatility, momentum, and participation evidence',
      );
    }
  });
export type AnticipatoryMarketSnapshot = z.infer<
  typeof AnticipatoryMarketSnapshotSchema
>;

export const TradeThesisDecisionSourceSchema = z.enum([
  'AI',
  'RULES',
  'AI_WITH_RULES_FALLBACK',
]);
export type TradeThesisDecisionSource = z.infer<
  typeof TradeThesisDecisionSourceSchema
>;

export const TradeThesisStateSchema = z.enum([
  'WATCHING',
  'PROBE_READY',
  'CONFIRMED',
  'TOO_LATE',
  'WAIT',
]);
export type TradeThesisState = z.infer<typeof TradeThesisStateSchema>;

export const TradeThesisSetupSchema = z.enum([
  'RANGE_REVERSAL',
  'LIQUIDITY_SWEEP_REVERSAL',
  'RECOVERY_RECLAIM',
  'SQUEEZE_PROBE',
  'BREAKOUT_RETEST',
  'TREND_PULLBACK',
  'NO_TRADE',
]);
export type TradeThesisSetup = z.infer<typeof TradeThesisSetupSchema>;

export const StructuredTriggerSchema = z
  .object({
    type: z.string().min(1),
    price: z.number().nullable(),
    description: z.string().min(1),
  })
  .strict();
export type StructuredTrigger = z.infer<typeof StructuredTriggerSchema>;

export const StructuredInvalidationSchema = z
  .object({
    price: z.number(),
    reason: z.string().min(1),
  })
  .strict();
export type StructuredInvalidation = z.infer<
  typeof StructuredInvalidationSchema
>;

export const StructuredTargetSchema = z
  .object({
    price: z.number(),
    fraction: z.number().min(0).max(1),
  })
  .strict();
export type StructuredTarget = z.infer<typeof StructuredTargetSchema>;

export const TradeThesisEntryZoneSchema = z
  .object({
    lower: z.number(),
    upper: z.number(),
  })
  .strict();
export type TradeThesisEntryZone = z.infer<typeof TradeThesisEntryZoneSchema>;

export const TradeThesisSchema = z
  .object({
    thesisVersion: z.number().int().positive(),
    decisionSource: TradeThesisDecisionSourceSchema,
    state: TradeThesisStateSchema,
    direction: z.enum(['LONG', 'SHORT', 'WAIT']),
    regime: z.string().min(1),
    transitionProbability: z.number().min(0).max(1),
    setup: TradeThesisSetupSchema,
    entryZone: TradeThesisEntryZoneSchema.nullable(),
    trigger: z.array(StructuredTriggerSchema),
    invalidation: StructuredInvalidationSchema.nullable(),
    stopLoss: z.number().nullable(),
    targets: z.array(StructuredTargetSchema),
    expectedNetR: z.number().nullable(),
    maximumChaseDistanceAtr: z.number().nonnegative(),
    confidence: z.number().min(0).max(100),
    evidenceFor: z.array(EvidenceRefSchema),
    evidenceAgainst: z.array(EvidenceRefSchema),
    missingEvidence: z.array(z.string()),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type TradeThesis = z.infer<typeof TradeThesisSchema>;

export const ThesisValidationReasonCodeSchema = z.enum([
  'THESIS_STALE',
  'EVIDENCE_REF_INVALID',
  'GEOMETRY_INVALID',
  'NET_R_TOO_LOW',
  'ENTRY_TOO_LATE',
  'PROTECTION_REQUIRED',
]);
export type ThesisValidationReasonCode = z.infer<
  typeof ThesisValidationReasonCodeSchema
>;

export const ThesisValidationResultSchema = z
  .object({
    valid: z.boolean(),
    status: z.enum(['VALID', 'INVALID']),
    reasonCodes: z.array(ThesisValidationReasonCodeSchema),
    reasons: z.array(z.string()),
  })
  .strict();
export type ThesisValidationResult = z.infer<
  typeof ThesisValidationResultSchema
>;

export const ThesisReviewActionSchema = z.enum([
  'APPROVE',
  'REDUCE_SIZE',
  'REQUIRE_TRIGGER',
  'CANCEL',
]);
export type ThesisReviewAction = z.infer<typeof ThesisReviewActionSchema>;

export const ThesisReviewSchema = z
  .object({
    action: ThesisReviewActionSchema,
    sizeFactor: z.number().min(0).max(1).optional(),
    reasonCodes: z.array(z.string()),
    evidenceRefs: z.array(EvidenceRefSchema),
    rationale: z.string(),
  })
  .strict();
export type ThesisReview = z.infer<typeof ThesisReviewSchema>;
