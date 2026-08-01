import { AgentType, AgentInvocationSource } from '../enums';

export interface AgentExecutionContext {
  readonly agentRunId: string;
  readonly traceId: string;
  readonly correlationId: string;
  readonly agentType: AgentType;
  readonly agentVersion: number;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly aiProvider: string;
  readonly model: string;
  readonly requestedAt: Date;
  readonly deadlineAt: Date;
  readonly invocationSource: AgentInvocationSource;
  readonly contextSnapshotId: string;
  readonly promptId: string;
  readonly promptVersion: number;
  readonly allowedToolNames: string[];
  readonly capabilities: string[];
  readonly cancellationSignal?: AbortSignal;
  readonly safeMetadata: Record<string, string>;
}
