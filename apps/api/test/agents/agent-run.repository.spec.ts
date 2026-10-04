import { describe, expect, it } from 'vitest';
import { AgentRunState } from '../../src/modules/agents/domain/enums';
import { AgentRunRepository } from '../../src/modules/agents/infrastructure/persistence/agent-run.repository';

function database(initialStatus: AgentRunState, failTransition = false) {
  let status = initialStatus;
  const transitions: Array<{ fromState: AgentRunState; toState: AgentRunState }> = [];
  const transaction = {
    agentRun: {
      updateMany: ({ where, data }: {
        where: { id: string; status: AgentRunState };
        data: { status: AgentRunState };
      }) => {
        if (where.id !== 'run-1' || where.status !== status) return Promise.resolve({ count: 0 });
        status = data.status;
        return Promise.resolve({ count: 1 });
      },
      findUniqueOrThrow: () => Promise.resolve({ id: 'run-1', status }),
    },
    agentRunTransition: {
      create: ({ data }: { data: { fromState: AgentRunState; toState: AgentRunState } }) => {
        if (failTransition) return Promise.reject(new Error('transition insert failed'));
        transitions.push({ fromState: data.fromState, toState: data.toState });
        return Promise.resolve(data);
      },
    },
  };
  return {
    db: { $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) => {
      const beforeStatus = status;
      const beforeTransitions = transitions.length;
      try {
        return await callback(transaction);
      } catch (error) {
        status = beforeStatus;
        transitions.splice(beforeTransitions);
        throw error;
      }
    } },
    status: () => status,
    transitions,
  };
}

describe('AgentRunRepository atomic transitions', () => {
  it('changes status and records its transition in one transaction', async () => {
    const state = database(AgentRunState.READY);
    const repository = new AgentRunRepository(state.db as never);

    const run = await repository.transitionRun({
      runId: 'run-1', fromState: AgentRunState.READY, toState: AgentRunState.RUNNING,
      reason: 'started', actor: 'test',
    });

    expect(run.status).toBe(AgentRunState.RUNNING);
    expect(state.status()).toBe(AgentRunState.RUNNING);
    expect(state.transitions).toEqual([{ fromState: AgentRunState.READY, toState: AgentRunState.RUNNING }]);
  });

  it('rejects a stale transition without writing misleading history', async () => {
    const state = database(AgentRunState.FAILED);
    const repository = new AgentRunRepository(state.db as never);

    await expect(repository.transitionRun({
      runId: 'run-1', fromState: AgentRunState.READY, toState: AgentRunState.RUNNING,
      reason: 'started', actor: 'test',
    })).rejects.toThrow('AGENT_RUN_STATE_CONFLICT');

    expect(state.status()).toBe(AgentRunState.FAILED);
    expect(state.transitions).toEqual([]);
  });

  it('rolls status back when transition history persistence fails', async () => {
    const state = database(AgentRunState.READY, true);
    const repository = new AgentRunRepository(state.db as never);

    await expect(repository.transitionRun({
      runId: 'run-1', fromState: AgentRunState.READY, toState: AgentRunState.RUNNING,
      reason: 'started', actor: 'test',
    })).rejects.toThrow('transition insert failed');

    expect(state.status()).toBe(AgentRunState.READY);
    expect(state.transitions).toEqual([]);
  });
});
