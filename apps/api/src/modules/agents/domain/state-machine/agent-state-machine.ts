import { AgentRunState } from '../enums/agent-run-state.enum';
import { AgentErrorCode, AgentError } from '../errors/agent-errors';
import * as crypto from 'crypto'; // Or generic depending on environment. Using crypto for Node.

export interface AgentRunTransition {
  readonly id: string;
  readonly runId: string;
  readonly fromState: AgentRunState;
  readonly toState: AgentRunState;
  readonly timestamp: Date;
  readonly reason: string;
  readonly actor: string;
  readonly correlationId: string;
}

export class AgentStateMachine {
  private static readonly VALID_TRANSITIONS = new Map<AgentRunState, AgentRunState[]>([
    [AgentRunState.CREATED, [AgentRunState.QUEUED, AgentRunState.PREPARING_CONTEXT, AgentRunState.REJECTED]],
    [AgentRunState.QUEUED, [AgentRunState.PREPARING_CONTEXT, AgentRunState.CANCEL_REQUESTED, AgentRunState.REJECTED]],
    [AgentRunState.PREPARING_CONTEXT, [AgentRunState.READY, AgentRunState.FAILED, AgentRunState.TIMED_OUT, AgentRunState.CANCEL_REQUESTED]],
    [AgentRunState.READY, [AgentRunState.RUNNING, AgentRunState.CANCEL_REQUESTED]],
    [AgentRunState.RUNNING, [AgentRunState.WAITING_FOR_TOOL, AgentRunState.VALIDATING_OUTPUT, AgentRunState.FAILED, AgentRunState.TIMED_OUT, AgentRunState.CANCEL_REQUESTED]],
    [AgentRunState.WAITING_FOR_TOOL, [AgentRunState.PROCESSING_TOOL_RESULT, AgentRunState.FAILED, AgentRunState.TIMED_OUT, AgentRunState.CANCEL_REQUESTED]],
    [AgentRunState.PROCESSING_TOOL_RESULT, [AgentRunState.RUNNING, AgentRunState.FAILED, AgentRunState.TIMED_OUT, AgentRunState.CANCEL_REQUESTED]],
    [AgentRunState.VALIDATING_OUTPUT, [AgentRunState.COMPLETED, AgentRunState.PARTIALLY_COMPLETED, AgentRunState.FAILED]],
    [AgentRunState.CANCEL_REQUESTED, [AgentRunState.CANCELLED]],
    [AgentRunState.COMPLETED, []],
    [AgentRunState.PARTIALLY_COMPLETED, []],
    [AgentRunState.FAILED, []],
    [AgentRunState.TIMED_OUT, []],
    [AgentRunState.CANCELLED, []],
    [AgentRunState.REJECTED, []],
  ]);

  public static validate(from: AgentRunState, to: AgentRunState): boolean {
    const validStates = this.VALID_TRANSITIONS.get(from) || [];
    return validStates.includes(to);
  }

  public static transition(
    runId: string,
    from: AgentRunState,
    to: AgentRunState,
    reason: string,
    actor: string,
    correlationId?: string,
  ): AgentRunTransition {
    if (!this.validate(from, to)) {
      throw new AgentError(
        AgentErrorCode.AGENT_STATE_TRANSITION_INVALID,
        `Invalid transition from ${from} to ${to}`
      );
    }
    return {
      id: crypto.randomUUID(),
      runId,
      fromState: from,
      toState: to,
      timestamp: new Date(),
      reason,
      actor,
      correlationId: correlationId || runId,
    };
  }

  public static isTerminal(state: AgentRunState): boolean {
    const validTransitions = this.VALID_TRANSITIONS.get(state);
    return !validTransitions || validTransitions.length === 0;
  }

  public static getValidTransitions(state: AgentRunState): AgentRunState[] {
    return this.VALID_TRANSITIONS.get(state) || [];
  }
}
