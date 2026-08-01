import type { ToolCapability } from "@platform/shared";

export type ToolInvocationSource =
  | "AI_PROVIDER"
  | "INTERNAL_AGENT"
  | "REST_DEBUG"
  | "AUTOMATED_TEST"
  | "SYSTEM_JOB";

export interface ToolExecutionContext {
  invocationId: string;
  traceId: string;
  correlationId: string;

  userId?: string;
  sessionId?: string;

  agentRunId?: string;
  agentType?: string;

  aiRequestId?: string;
  provider?: string;
  model?: string;

  requestedAt: Date;
  deadlineAt: Date;

  source: ToolInvocationSource;
  cancellationSignal?: AbortSignal;

  capabilities: ToolCapability[];
  safeMetadata: Record<string, string>;
}
