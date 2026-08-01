import { z } from 'zod';

export const EvaluationHorizonSchema = z.enum(['SHORT', 'MID', 'LONG']);
export const PerformanceOutcomeSchema = z.enum(['CORRECT', 'WRONG', 'NEUTRAL']);

export const PerformanceRecordSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  symbol: z.string(),
  horizon: EvaluationHorizonSchema,
  decision: z.enum(['LONG', 'SHORT', 'WAIT']),
  confidence: z.number().min(0).max(100),
  priceAtDecision: z.number().positive(),
  priceAfter: z.number().positive(),
  outcome: PerformanceOutcomeSchema,
  returnPct: z.number(),
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

export interface PerformanceMetrics {
  total: number;
  directionalDecisions: number;
  winRate: number;
  accuracy: number;
  averageReturn: number;
  maxDrawdown: number;
  confidenceAccuracyCorrelation: number | null;
  decisionDistribution: { LONG: number; SHORT: number; WAIT: number };
  horizonDistribution: { SHORT: number; MID: number; LONG: number };
}
