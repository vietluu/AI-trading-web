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
