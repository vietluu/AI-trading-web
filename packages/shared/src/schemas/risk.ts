import { z } from "zod";

export const RiskOutputSchema = z.object({
  approved: z.boolean(),
  reason: z.string().optional(),
  positionSize: z.number().positive().optional(),
  leverage: z.number().int().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  riskScore: z.number().min(0).max(100),
});
export type RiskOutput = z.infer<typeof RiskOutputSchema>;

export const RiskAssessmentSchema = RiskOutputSchema.extend({
  id: z.string().uuid(),
  pipelineRunId: z.string().uuid().nullable(),
  symbol: z.string(),
  decision: z.enum(["LONG", "SHORT", "WAIT"]),
  confidence: z.number().min(0).max(100),
  referencePrice: z.number().positive(),
  volatility: z.number().min(0),
  exposurePct: z.number().min(0),
  drawdownPct: z.number().min(0),
  createdAt: z.string().datetime(),
});
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

export const RiskDashboardSchema = z.object({
  config: z.object({
    riskPerTrade: z.number(),
    maxPositions: z.number().int(),
    maxLeverage: z.number().int(),
    maxDrawdown: z.number(),
    maxExposure: z.number(),
    cooldownMs: z.number().int(),
  }),
  portfolio: z.object({
    balance: z.number(),
    equity: z.number(),
    peakEquity: z.number(),
    openPositions: z.number().int(),
    exposure: z.number(),
    exposurePct: z.number(),
    drawdownPct: z.number(),
  }),
  assessments: z.array(RiskAssessmentSchema),
});
export type RiskDashboard = z.infer<typeof RiskDashboardSchema>;
