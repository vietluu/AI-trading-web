import { z } from "zod";

export const PipelineIdSchema = z.literal("FULL_ANALYSIS_DECISION");
export const PipelineProviderSchema = z.enum([
  "BINANCE_FUTURES",
  "OKX_FUTURES",
]);
export const PipelineTriggerSchema = z.enum([
  "SCHEDULE",
  "MANUAL",
  "REPLAY",
  "EVENT",
]);
export const PipelineRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMEOUT",
  "SKIPPED",
]);

export const CanonicalRegimeSchema = z.enum([
  "RANGING",
  "PRE_BREAKOUT",
  "BREAKOUT",
  "TRENDING",
  "UNCERTAIN",
]);
export type CanonicalRegime = z.infer<typeof CanonicalRegimeSchema>;

export const CanonicalSetupSchema = z.enum([
  "RANGE_REVERSION",
  "TRANSITION_PROBE",
  "BREAKOUT_RETEST",
  "TREND_PULLBACK",
]);
export type CanonicalSetup = z.infer<typeof CanonicalSetupSchema>;

export const EntryActionSchema = z.enum(["WAIT", "PROBE", "ENTER"]);
export type EntryAction = z.infer<typeof EntryActionSchema>;

export const RiskTierSchema = z.enum(["NONE", "PROBE", "NORMAL"]);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const ExecutionContextSchema = z
  .object({
    regime: CanonicalRegimeSchema,
    regimeDetail: z.string().min(1).optional(),
    setup: CanonicalSetupSchema,
    action: EntryActionSchema,
    riskTier: RiskTierSchema,
    sourceDataCutoff: z.string().datetime(),
    usesClosedPrimaryCandle: z.boolean(),
    triggerConfirmed: z.boolean(),
    priceLocation: z
      .object({
        rangePercentile: z.number().min(0).max(1).optional(),
        distanceFromSupportAtr: z.number().nonnegative().optional(),
        distanceFromResistanceAtr: z.number().nonnegative().optional(),
        distanceFromTriggerAtr: z.number().nonnegative().optional(),
        moveConsumedPct: z.number().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;

export const StoredPipelineContextSchema = z
  .object({
    executionContext: ExecutionContextSchema.optional(),
  })
  .passthrough();
export type StoredPipelineContext = z.infer<typeof StoredPipelineContextSchema>;

export const PipelineSymbolSchema = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[A-Z0-9]+-[A-Z0-9]+$/, "Symbol must be in BASE-QUOTE format (e.g. BTC-USDT)");
export type PipelineSymbol = z.infer<typeof PipelineSymbolSchema>;
export const PortfolioStrategyKeySchema = z.enum([
  "ai-core",
  "trend",
  "mean-reversion",
  "breakout",
  "momentum-scalp",
  "news",
]);

export const PipelineRunRequestSchema = z
  .object({
    symbol: PipelineSymbolSchema,
    provider: PipelineProviderSchema,
    pipelineId: PipelineIdSchema.default("FULL_ANALYSIS_DECISION"),
    params: z.record(z.unknown()).default({}),
  })
  .strict();
export type PipelineRunRequest = z.infer<typeof PipelineRunRequestSchema>;

export const PipelineGateStageSchema = z.enum([
  "SIGNAL_FILTER",
  "JUDGE",
  "QUANT",
  "MULTI_TIMEFRAME",
  "RISK",
  "EXECUTION",
]);
export const PipelineGateDispositionSchema = z.enum([
  "PASS",
  "ADVISORY",
  "REDUCE_SIZE",
  "BLOCK",
]);
export const PipelineGateDecisionRecordSchema = z.object({
  stage: PipelineGateStageSchema,
  disposition: PipelineGateDispositionSchema,
  reasonCodes: z.array(z.string()),
  selectedBlockingReason: z.string().optional(),
});
export const PipelineBlockingGateSchema = z.object({
  stage: PipelineGateStageSchema,
  reason: z.string(),
});
export const PipelineRunResultSchema = z.object({
  gates: z.array(PipelineGateDecisionRecordSchema).optional(),
  blockingGate: PipelineBlockingGateSchema.optional(),
}).passthrough();
export type PipelineGateStage = z.infer<typeof PipelineGateStageSchema>;
export type PipelineGateDisposition = z.infer<typeof PipelineGateDispositionSchema>;
export type PipelineGateDecisionRecord = z.infer<typeof PipelineGateDecisionRecordSchema>;
export type PipelineBlockingGate = z.infer<typeof PipelineBlockingGateSchema>;
export type PipelineRunResult = z.infer<typeof PipelineRunResultSchema>;

export const PipelineScheduleInputSchema = z
  .object({
    pipelineId: PipelineIdSchema.default("FULL_ANALYSIS_DECISION"),
    symbols: z.array(PipelineSymbolSchema).min(1).max(25),
    strategyIds: z
      .array(PortfolioStrategyKeySchema)
      .min(1)
      .max(6)
      .default(["ai-core", "trend", "mean-reversion", "breakout", "momentum-scalp", "news"]),
    provider: PipelineProviderSchema,
    mode: z.enum(["CRON", "INTERVAL"]),
    cron: z.string().max(100).optional(),
    // Scheduled analysis fans out across several agents and external providers.
    // Five minutes is the hard floor to avoid provider throttling/account spam.
    intervalMs: z.number().int().min(300_000).max(86_400_000).optional(),
    enabled: z.boolean().default(true),
    timezone: z.string().min(1).max(64).default("UTC"),
    maxRunsPerHour: z.number().int().min(1).max(120).default(60),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === "CRON" && !value.cron)
      ctx.addIssue({
        code: "custom",
        path: ["cron"],
        message: "cron is required for CRON mode",
      });
    if (value.mode === "INTERVAL" && value.intervalMs === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["intervalMs"],
        message: "intervalMs is required for INTERVAL mode",
      });
  });
export type PipelineScheduleInput = z.infer<typeof PipelineScheduleInputSchema>;

export const PipelineReplayRequestSchema = z
  .object({
    mode: z
      .enum(["REPLAY_WITH_STORED_CONTEXT", "REPLAY_WITH_LIVE_DATA"])
      .default("REPLAY_WITH_STORED_CONTEXT"),
  })
  .strict();

export interface RetryPolicy {
  attempts: number;
  backoffMs: number;
}
export interface PipelineStep {
  id: string;
  type: "AGENT" | "FUSION" | "DECISION";
  ref: string;
  dependsOn?: string[];
  timeoutMs?: number;
  optional?: boolean;
}
export interface PipelineDefinition {
  id: string;
  version: number;
  description: string;
  steps: PipelineStep[];
  defaultParams: Record<string, unknown>;
  timeoutMs: number;
  maxConcurrency: number;
  retryPolicy: RetryPolicy;
  enabled: boolean;
}
