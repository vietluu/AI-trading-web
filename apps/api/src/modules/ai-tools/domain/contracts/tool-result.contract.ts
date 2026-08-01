import type { ToolErrorCode } from "@platform/shared";

export type ToolResultStatus =
  | "SUCCESS"
  | "PARTIAL"
  | "FAILED"
  | "DENIED"
  | "CANCELLED"
  | "TIMED_OUT";

export interface ToolResultError {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  safeDetails?: Record<string, string>;
}

export interface ToolResultMetadata {
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  cached: boolean;
  stale: boolean;
  sourceTimestamp?: Date;
  schemaVersion: number;
}

export interface ToolResult<T = unknown> {
  invocationId: string;
  toolName: string;
  toolVersion: number;
  status: ToolResultStatus;
  data?: T;
  error?: ToolResultError;
  metadata: ToolResultMetadata;
}
