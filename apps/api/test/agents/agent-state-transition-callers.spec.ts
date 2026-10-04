import { describe, expect, it, vi } from 'vitest';
import { AgentCancellationHandlerService } from '../../src/modules/agents/application/services/agent-cancellation-handler.service';
import { AgentExecutionService } from '../../src/modules/agents/application/services/agent-execution.service';
import { AgentInvocationSource, AgentRunState, AgentType } from '../../src/modules/agents/domain/enums';

describe('agent state transition callers', () => {
  it('cancellation uses the conditional atomic transition', async () => {
    const transitionRun = vi.fn().mockResolvedValue({ id: 'run-1', status: AgentRunState.CANCEL_REQUESTED });
    const updateRun = vi.fn();
    const addTransition = vi.fn();
    const service = new AgentCancellationHandlerService(
      { requestCancellation: vi.fn().mockResolvedValue(undefined) } as never,
      { findById: vi.fn().mockResolvedValue({ id: 'run-1', status: AgentRunState.RUNNING }),
        transitionRun, updateRun, addTransition } as never,
      {} as never,
    );

    expect(await service.cancelRun('run-1', 'user-1', 'stop')).toBe(true);
    expect(transitionRun).toHaveBeenCalledWith({
      runId: 'run-1', fromState: AgentRunState.RUNNING, toState: AgentRunState.CANCEL_REQUESTED,
      reason: 'stop', actor: 'AgentCancellationHandlerService',
    });
    expect(updateRun).not.toHaveBeenCalled();
    expect(addTransition).not.toHaveBeenCalled();
  });

  it('async enqueue persists CREATED to QUEUED atomically before publishing', async () => {
    const run = { id: 'run-1', status: AgentRunState.CREATED };
    const transitionRun = vi.fn().mockResolvedValue({ ...run, status: AgentRunState.QUEUED });
    const updateRun = vi.fn();
    const addTransition = vi.fn();
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const service = new AgentExecutionService(
      { resolve: vi.fn().mockReturnValue({ version: 1, promptId: 'prompt', promptVersion: 1 }) } as never,
      { evaluate: vi.fn().mockResolvedValue({ status: 'ALLOW', reasons: [] }) } as never,
      {} as never,
      { enqueue } as never,
      { createRun: vi.fn().mockResolvedValue(run), transitionRun, updateRun, addTransition } as never,
    );

    await service.executeAsync({ agentType: AgentType.MARKET_ANALYST, userId: 'user-1', input: {},
      invocationSource: AgentInvocationSource.INTERNAL_SERVICE });

    expect(transitionRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1', fromState: AgentRunState.CREATED, toState: AgentRunState.QUEUED,
      actor: 'AgentExecutionService',
    }));
    expect(updateRun).not.toHaveBeenCalled();
    expect(addTransition).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledOnce();
  });
});
