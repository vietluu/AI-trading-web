import { type AgentType, type AgentRunState, type AgentInvocationSource } from '../enums';

export interface AgentRunRecord {
  readonly id: string;
  readonly userId: string | null;
  readonly agentType: AgentType;
  readonly agentVersion: number;
  readonly status: AgentRunState;
  readonly invocationSource: AgentInvocationSource;
  readonly inputHash: string;
  readonly sanitizedInput?: string;
  readonly output?: string;
  readonly outputSchemaVersion: number;
  readonly promptId: string;
  readonly promptVersion: number;
  readonly contextSnapshotId: string;
  readonly provider: string;
  readonly model: string;
  readonly startedAt: Date;
  readonly completedAt?: Date;
  readonly durationMs?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly estimatedCost: number;
  readonly actualCost?: number;
  readonly toolCallCount: number;
  readonly toolRoundCount: number;
  readonly retryCount: number;
  readonly failureCode?: string;
  readonly safeFailureMessage?: string;
  readonly traceId: string;
  readonly correlationId: string;
  readonly parentRunId?: string;
  readonly replayOfRunId?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
