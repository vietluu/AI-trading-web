import { z } from 'zod';

export const EvaluationHorizonSchema = z.enum(['M15', 'M30', 'SHORT', 'MID', 'H2', 'H4', 'LONG']);
export const PerformanceOutcomeSchema = z.enum(['CORRECT', 'WRONG', 'NEUTRAL']);

export const PerformanceRecordSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  symbol: z.string(),
  strategyKey: z.string().optional(),
  horizon: EvaluationHorizonSchema,
  decision: z.enum(['LONG', 'SHORT', 'WAIT']),
  confidence: z.number().min(0).max(100),
  priceAtDecision: z.number().positive(),
  priceAfter: z.number().positive(),
  outcome: PerformanceOutcomeSchema,
  returnPct: z.number(),
  leverage: z.number().int().min(1),
  netRoePct: z.number(),
  leverageSource: z.enum(['RISK_ASSESSMENT', 'SHADOW_CONFIG', 'UNLEVERAGED']),
  evaluatedAt: z.string().datetime(),
});
export type PerformanceRecord = z.infer<typeof PerformanceRecordSchema>;

export const ReflectionOutputSchema = z.object({
  summary: z.string(),
  accuracy: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  patterns: z.array(z.string()),
  suggestions: z.array(z.string()),
  generatedAt: z.string().datetime(),
  actualTrading: z.object({
    source: z.literal('EXCHANGE_CLOSED_TRADE_LEDGER'),
    totalTrades: z.number().int().nonnegative(),
    completeTrades: z.number().int().nonnegative(),
    winRate: z.number().min(0).max(100),
    grossPnl: z.number(),
    fees: z.number(),
    netPnl: z.number(),
    profitFactor: z.number().nullable(),
  }).optional(),
});
export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;

export const ReflectionInsightSchema = z.object({
  id: z.string().uuid(),
  summary: z.string(),
  category: z.enum(['RISK', 'BIAS', 'DATA', 'TIMING']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  createdAt: z.string().datetime(),
});

export const ImprovementProposalSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  proposedChange: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  createdAt: z.string().datetime(),
});

export const ImprovementProposalInputSchema = z.object({
  description: z.string().trim().min(3).max(500),
  proposedChange: z.string().trim().min(3).max(1000),
}).strict();

export const ImprovementProposalReviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  confirmed: z.literal(true),
}).strict();

export const SelfLearningLifecycleStageSchema = z.enum([
  'LIVE',
  'SHADOW',
  'CANARY',
  'LIVE_ELIGIBLE',
]);
export type SelfLearningLifecycleStage = z.infer<typeof SelfLearningLifecycleStageSchema>;

export const LiveEligibilityMetricsSchema = z.object({
  outOfSampleAccuracy: z.number(),
  expectancy: z.number(),
  profitFactor: z.number(),
  sharpeRatio: z.number(),
  maxDrawdownPct: z.number(),
  shadowTrades: z.number().int().nonnegative(),
  canaryTrades: z.number().int().nonnegative(),
});
export type LiveEligibilityMetrics = z.infer<typeof LiveEligibilityMetricsSchema>;

export const LiveEligibilityCandidateSchema = z.object({
  version: z.number().int().positive(),
  weights: z.record(z.string(), z.number()),
  threshold: z.number(),
  metrics: LiveEligibilityMetricsSchema,
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  eligibleAt: z.string().datetime(),
});
export type LiveEligibilityCandidate = z.infer<typeof LiveEligibilityCandidateSchema>;

export const LiveEligibilityReviewInputSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  version: z.number().int().positive(),
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();
export type LiveEligibilityReviewInput = z.infer<typeof LiveEligibilityReviewInputSchema>;

export const SelfLearningLifecycleDtoSchema = z.object({
  stage: SelfLearningLifecycleStageSchema,
  isEnabled: z.boolean(),
  liveVersion: z.number().int().positive(),
  candidateVersion: z.number().int().positive().nullable(),
  liveImpactPct: z.number(),
  candidateImpactPct: z.number(),
  shadowPerformance: z.any().nullable().optional(),
  evidence: z.object({
    pendingShadowSignals: z.number().int().nonnegative(),
    evaluatedShadowSignals: z.number().int().nonnegative(),
    canaryRecords: z.number().int().nonnegative(),
    liveRecords: z.number().int().nonnegative(),
  }),
  startedAt: z.string().datetime().nullable().optional(),
  lastPromotionAt: z.string().datetime().nullable().optional(),
  eligibleCandidate: LiveEligibilityCandidateSchema.nullable().optional(),
  approvedCandidate: z.object({
    version: z.number().int().positive(),
    configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
    approvedAt: z.string().datetime(),
  }).nullable().optional(),
  experiment: z.any().nullable().optional(),
});
export type SelfLearningLifecycleDto = z.infer<typeof SelfLearningLifecycleDtoSchema>;

export interface PerformanceMetrics {
  total: number;
  directionalDecisions: number;
  winRate: number;
  accuracy: number;
  averageReturn: number;
  maxDrawdown: number;
  confidenceAccuracyCorrelation: number | null;
  decisionDistribution: { LONG: number; SHORT: number; WAIT: number };
  horizonDistribution: { M15: number; M30: number; SHORT: number; MID: number; H2: number; H4: number; LONG: number };
}

