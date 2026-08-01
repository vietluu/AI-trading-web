import type { ZodType } from "zod";
import type {
  ToolCapability,
  ToolCategory,
  ToolExecutionMode,
  ToolSensitivity,
  ToolSideEffect,
  ToolStatus,
} from "@platform/shared";
import type { ToolExecutionContext } from "./tool-context.contract";

export interface ToolCachePolicy {
  type: "NONE" | "REQUEST_SCOPE" | "SHORT_TTL" | "SOURCE_TIMESTAMP_AWARE";
  ttlSeconds?: number;
}

export interface ToolRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors: string[];
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly version: number;
  readonly displayName: string;
  readonly description: string;
  readonly category: ToolCategory;

  readonly inputSchema: ZodType<TInput>;
  readonly outputSchema: ZodType<TOutput>;

  readonly executionMode: ToolExecutionMode;
  readonly sensitivity: ToolSensitivity;
  readonly sideEffect: ToolSideEffect;
  readonly cachePolicy: ToolCachePolicy;
  readonly retryPolicy: ToolRetryPolicy;
  readonly timeoutMs: number;

  readonly requiresAuthentication: boolean;
  readonly userScoped: boolean;
  readonly allowedAgentTypes: string[];
  readonly requiredCapabilities: ToolCapability[];

  readonly status: ToolStatus;
  readonly schemaHash: string;

  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}
