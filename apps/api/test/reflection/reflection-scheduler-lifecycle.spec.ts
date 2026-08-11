import { describe, expect, it, vi } from 'vitest';
import { ReflectionSchedulerService } from '../../src/modules/reflection/application/reflection-scheduler.service';

function createHarness(evaluatedUserIds: string[], activeUserIds: string[]) {
  const performance = {
    evaluateDue: vi.fn().mockResolvedValue({
      evaluated: evaluatedUserIds.length,
      evaluatedUserIds,
      skipped: 0,
      failed: 0,
    }),
  };
  const selfLearning = {
    activeLifecycleUserIds: vi.fn().mockResolvedValue(activeUserIds),
    evaluateShadowSignals: vi.fn().mockResolvedValue(undefined),
    evaluateCanary: vi.fn().mockResolvedValue(undefined),
    evaluateLiveRollback: vi.fn().mockResolvedValue(false),
    tuneParameters: vi.fn().mockResolvedValue(undefined),
    optimizeAgentWeights: vi.fn().mockResolvedValue(undefined),
  };
  const scheduler = new ReflectionSchedulerService(
    performance as never,
    selfLearning as never,
    { get: vi.fn().mockReturnValue(true) } as never,
  );
  return { scheduler, selfLearning };
}

describe('ReflectionSchedulerService automated lifecycle', () => {
  it('continues shadow/canary evaluation even when no new performance row is created', async () => {
    const { scheduler, selfLearning } = createHarness([], ['user-shadow']);

    await (scheduler as unknown as { sweepOnce(): Promise<void> }).sweepOnce();

    expect(selfLearning.evaluateShadowSignals).toHaveBeenCalledWith('user-shadow');
    expect(selfLearning.evaluateCanary).toHaveBeenCalledWith('user-shadow');
    expect(selfLearning.evaluateLiveRollback).toHaveBeenCalledWith('user-shadow');
    expect(selfLearning.optimizeAgentWeights).not.toHaveBeenCalled();
  });

  it('deduplicates active users and only trains a new candidate from newly evaluated evidence', async () => {
    const { scheduler, selfLearning } = createHarness(['user-new'], ['user-new', 'user-canary']);

    await (scheduler as unknown as { sweepOnce(): Promise<void> }).sweepOnce();

    expect(selfLearning.evaluateShadowSignals).toHaveBeenCalledTimes(2);
    expect(selfLearning.tuneParameters).toHaveBeenCalledTimes(1);
    expect(selfLearning.tuneParameters).toHaveBeenCalledWith('user-new');
    expect(selfLearning.optimizeAgentWeights).toHaveBeenCalledTimes(1);
  });
});
