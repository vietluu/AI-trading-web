import { describe, expect, it, vi } from 'vitest';
import { PipelineService } from '../../src/modules/pipeline/application/pipeline.service';
import { PipelineSchedulerService } from '../../src/modules/pipeline/application/pipeline-scheduler.service';
import { SignalFilterService } from '../../src/modules/pipeline/application/signal-filter.service';
import { PlatformAIGuard } from '../../src/modules/ai/presentation/controllers/platform-ai.guard';
import { PipelineController } from '../../src/modules/pipeline/presentation/pipeline.controller';

describe('event-only operation', () => {
  it('exposes only the current user event subscriptions without account identifiers', async () => {
    const subscribers = { list: vi.fn().mockResolvedValue([
      { userId: 'alice', symbol: 'BTC-USDT', provider: 'OKX_FUTURES', strategyIds: ['alice-strategy'] },
      { userId: 'bob', symbol: 'ETH-USDT', provider: 'BINANCE_FUTURES', strategyIds: ['bob-strategy'] },
    ]) };
    const controller = new PipelineController({} as never, {} as never, {} as never, {} as never, subscribers as never);
    await expect(controller.subscriptions({ id: 'alice' })).resolves.toEqual([
      { symbol: 'BTC-USDT', provider: 'OKX_FUTURES', strategyIds: ['alice-strategy'] },
    ]);
    await expect(controller.subscriptions({ id: 'unknown' })).resolves.toEqual([]);
  });

  it('recovers a run persisted before queue failure without creating a second run', async () => {
    const run = { id: '11111111-1111-4111-8111-111111111111', status: 'QUEUED' };
    const repository = { findRun: vi.fn(() => Promise.resolve(run)), createSteps: vi.fn(), createRun: vi.fn() };
    const queue = { enqueue: vi.fn() };
    const service = new PipelineService(repository as never, queue as never, { enabled: true } as never);
    const request = { pipelineId: 'FULL_ANALYSIS_DECISION', symbol: 'BTC-USDT', provider: 'OKX_FUTURES', params: {} };
    await service.trigger('user', request, 'EVENT', { eventRunId: run.id });
    expect(repository.createRun).not.toHaveBeenCalled();
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ runId: run.id }));
    run.status = 'COMPLETED';
    await service.trigger('user', request, 'EVENT', { eventRunId: run.id });
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('heartbeat does not scan schedules or trigger periodic AI', async () => {
    const findMany = vi.fn();
    const trigger = vi.fn();
    const scheduler = new PipelineSchedulerService({ pipelineSchedule: { findMany } } as never,
      { trigger } as never, { enabled: true, eventDrivenOnly: true } as never);
    await scheduler.tick();
    expect(findMany).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
    await expect(scheduler.create('user', {})).rejects.toThrow('Scheduled AI is disabled');
  });

  it('lets a confirmed event start research before slow indicators react, retaining data and spread gates', () => {
    const filter = new SignalFilterService();
    const quiet = { symbol: 'BTC-USDT', price: 100_000, rsi: 50, atr: 0.01,
      volumeChangePercent: 0, adx: 10, efficiencyRatio: 0.1 };
    expect(filter.evaluate(quiet).allowed).toBe(false);
    expect(filter.evaluate({ ...quiet, materialEvent: true }).allowed).toBe(true);
    expect(filter.evaluate({ symbol: 'BTC-USDT', materialEvent: true }).reason).toBe('INSUFFICIENT_INDICATORS');
    expect(filter.evaluate({ ...quiet, materialEvent: true, spreadBps: 10_000 }).reason).toBe('WIDE_SPREAD');
  });

  it('denies direct access to platform AI controls', () => {
    expect(() => new PlatformAIGuard().canActivate()).toThrow('managed by the platform');
  });
});
