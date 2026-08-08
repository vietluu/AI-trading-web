import { describe, expect, it, vi } from 'vitest';
import { PipelineService } from '../../src/modules/pipeline/application/pipeline.service';

describe('PipelineService', () => {
  it('queues manual runs so HTTP requests respect worker backpressure', async () => {
    const repository = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      createSteps: vi.fn().mockResolvedValue(undefined),
      updateRun: vi.fn().mockResolvedValue(undefined),
      countRecent: vi.fn().mockResolvedValue(0),
      latestForSymbol: vi.fn().mockResolvedValue(null),
    };
    const queue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    };
    const config = {
      enabled: true,
      maxRunsPerHour: 120,
      cooldownMs: 60_000,
    };
    const runner = {
      run: vi.fn().mockResolvedValue(undefined),
    };

    const service = new PipelineService(repository as never, queue as never, config as never, runner as never);

    const result = await service.trigger(
      'user-1',
      {
        pipelineId: 'FULL_ANALYSIS_DECISION',
        symbol: 'SOL-USDT',
        provider: 'OKX_FUTURES',
        params: {},
      },
      'MANUAL',
    );

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        pipelineId: 'FULL_ANALYSIS_DECISION',
        symbol: 'SOL-USDT',
        provider: 'OKX_FUTURES',
      }),
    );
    expect(runner.run).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'run-1' });
  });
});
