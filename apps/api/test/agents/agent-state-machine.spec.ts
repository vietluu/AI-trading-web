import { describe, it, expect } from 'vitest';
import { AgentStateMachine } from '../../src/modules/agents/domain/state-machine/agent-state-machine';
import { AgentRunState } from '../../src/modules/agents/domain/enums';
import { AgentError, AgentErrorCode } from '../../src/modules/agents/domain/errors/agent-errors';

describe('AgentStateMachine', () => {
  it('should validate allowed state transitions', () => {
    expect(AgentStateMachine.validate(AgentRunState.CREATED, AgentRunState.PREPARING_CONTEXT)).toBe(true);
    expect(AgentStateMachine.validate(AgentRunState.PREPARING_CONTEXT, AgentRunState.READY)).toBe(true);
    expect(AgentStateMachine.validate(AgentRunState.READY, AgentRunState.RUNNING)).toBe(true);
    expect(AgentStateMachine.validate(AgentRunState.RUNNING, AgentRunState.VALIDATING_OUTPUT)).toBe(true);
    expect(AgentStateMachine.validate(AgentRunState.VALIDATING_OUTPUT, AgentRunState.COMPLETED)).toBe(true);
  });

  it('should reject invalid state transitions', () => {
    expect(AgentStateMachine.validate(AgentRunState.CREATED, AgentRunState.COMPLETED)).toBe(false);
    expect(AgentStateMachine.validate(AgentRunState.COMPLETED, AgentRunState.RUNNING)).toBe(false);
  });

  it('should throw AgentError on invalid transition execution', () => {
    expect(() => {
      AgentStateMachine.transition('run-123', AgentRunState.CREATED, AgentRunState.COMPLETED, 'Invalid transition', 'Test');
    }).toThrowError(AgentError);
  });

  it('should identify terminal states', () => {
    expect(AgentStateMachine.isTerminal(AgentRunState.COMPLETED)).toBe(true);
    expect(AgentStateMachine.isTerminal(AgentRunState.FAILED)).toBe(true);
    expect(AgentStateMachine.isTerminal(AgentRunState.CANCELLED)).toBe(true);
    expect(AgentStateMachine.isTerminal(AgentRunState.RUNNING)).toBe(false);
  });
});
