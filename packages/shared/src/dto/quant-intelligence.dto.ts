import { z } from 'zod';

export const ScorecardDimensionsSchema = z.object({
  architecture: z.number().min(0).max(100),
  research: z.number().min(0).max(100),
  trading: z.number().min(0).max(100),
  execution: z.number().min(0).max(100),
  risk: z.number().min(0).max(100),
  benchmark: z.number().min(0).max(100),
  aiQuality: z.number().min(0).max(100),
  robustness: z.number().min(0).max(100),
  explainability: z.number().min(0).max(100),
  productionReadiness: z.number().min(0).max(100),
});

export const DecisionScorecardSchema = z.object({
  overallScore: z.number().min(0).max(100),
  grade: z.string(),
  dimensions: ScorecardDimensionsSchema,
  expectedValue: z.number(),
  profitFactor: z.number(),
  sharpeRatio: z.number(),
  calmarRatio: z.number(),
  maxDrawdownPct: z.number(),
  walkForwardStability: z.number(),
  monteCarloSurvivalRate: z.number(),
  evaluatedAt: z.string(),
});

export type ScorecardDimensions = z.infer<typeof ScorecardDimensionsSchema>;
export type DecisionScorecard = z.infer<typeof DecisionScorecardSchema>;

export const QuantRecommendationSchema = z.object({
  id: z.string(),
  title: z.string(),
  moduleSource: z.string(),
  problemStatement: z.string(),
  evidenceText: z.string(),
  historicalResult: z.record(z.unknown()),
  expectedBenefit: z.string(),
  estimatedRisk: z.string(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  implementationCost: z.string(),
  rollbackPlan: z.string(),
  status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'DEPLOYED', 'ROLLED_BACK']),
  createdAt: z.string(),
});

export type QuantRecommendationDto = z.infer<typeof QuantRecommendationSchema>;

export const SimulationExperimentSchema = z.object({
  id: z.string(),
  name: z.string(),
  experimentType: z.enum(['PROMPT', 'THRESHOLD', 'INDICATOR', 'AGENT', 'WEIGHT', 'STRATEGY']),
  configJson: z.record(z.unknown()),
  simulationResult: z.record(z.unknown()),
  passedCriteria: z.boolean(),
  executedAt: z.string(),
});

export type SimulationExperimentDto = z.infer<typeof SimulationExperimentSchema>;
