import { AgentRunState } from '../enums/agent-run-state.enum';
import { AgentType } from '../enums/agent-type.enum';

export enum AgentEventType {
  AGENT_REGISTERED = 'AGENT_REGISTERED',
  AGENT_RUN_CREATED = 'AGENT_RUN_CREATED',
  AGENT_RUN_QUEUED = 'AGENT_RUN_QUEUED',
  AGENT_CONTEXT_PREPARATION_STARTED = 'AGENT_CONTEXT_PREPARATION_STARTED',
  AGENT_CONTEXT_READY = 'AGENT_CONTEXT_READY',
  AGENT_RUN_STARTED = 'AGENT_RUN_STARTED',
  AGENT_TOOL_REQUESTED = 'AGENT_TOOL_REQUESTED',
  AGENT_TOOL_COMPLETED = 'AGENT_TOOL_COMPLETED',
  AGENT_OUTPUT_VALIDATION_STARTED = 'AGENT_OUTPUT_VALIDATION_STARTED',
  AGENT_RUN_COMPLETED = 'AGENT_RUN_COMPLETED',
  AGENT_RUN_PARTIALLY_COMPLETED = 'AGENT_RUN_PARTIALLY_COMPLETED',
  AGENT_RUN_FAILED = 'AGENT_RUN_FAILED',
  AGENT_RUN_TIMED_OUT = 'AGENT_RUN_TIMED_OUT',
  AGENT_RUN_CANCEL_REQUESTED = 'AGENT_RUN_CANCEL_REQUESTED',
  AGENT_RUN_CANCELLED = 'AGENT_RUN_CANCELLED',
  AGENT_POLICY_DENIED = 'AGENT_POLICY_DENIED',
  AGENT_BUDGET_BLOCKED = 'AGENT_BUDGET_BLOCKED'
}

export interface AgentEvent {
  readonly eventId: string;
  readonly runId: string;
  readonly agentType: AgentType;
  readonly userId?: string;
  readonly timestamp: Date;
  readonly state: AgentRunState;
  readonly correlationId: string;
  readonly schemaVersion: number;
  readonly safeMetadata: Record<string, unknown>;
}
