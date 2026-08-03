import { describe, expect, it, vi } from 'vitest';
import { cronMatches, validateCron } from '../../src/modules/pipeline/domain/cron';
import { pipelineSkipReason } from '../../src/modules/pipeline/domain/rate-limit';
import { FULL_ANALYSIS_DECISION } from '../../src/modules/pipeline/domain/pipeline.definition';
import { PipelineThresholdService } from '../../src/modules/pipeline/application/pipeline-threshold.service';
import { PipelineSchedulerService } from '../../src/modules/pipeline/application/pipeline-scheduler.service';
import { PIPELINE_DEAD_LETTER_QUEUE_NAME, PIPELINE_RETRY_QUEUE_NAME, PIPELINE_RUN_QUEUE_NAME } from '../../src/modules/pipeline/infrastructure/pipeline-queue.constants';

describe('Phase 6.6 pipeline runtime policies', () => {
  it('validates and matches five-field cron expressions in the requested timezone', () => {
    expect(() => validateCron('*/5 * * * *')).not.toThrow();
    expect(() => validateCron('* * *')).toThrow();
    expect(cronMatches('30 9 * * 1-5', new Date('2026-08-03T09:30:00Z'), 'UTC')).toBe(true);
    expect(cronMatches('30 9 * * 1-5', new Date('2026-08-03T09:31:00Z'), 'UTC')).toBe(false);
  });

  it('enforces hourly quota and symbol cooldown while allowing explicit replay', () => {
    const now = new Date('2026-08-01T12:00:00Z'); const latestCreatedAt = new Date(now.getTime() - 10_000);
    expect(pipelineSkipReason({ hourlyCount: 60, hourlyLimit: 60, now, cooldownMs: 60_000, replay: false })).toBe('MAX_RUNS_PER_HOUR');
    expect(pipelineSkipReason({ hourlyCount: 1, hourlyLimit: 60, latestCreatedAt, now, cooldownMs: 60_000, replay: false })).toBe('SYMBOL_COOLDOWN_ACTIVE');
    expect(pipelineSkipReason({ hourlyCount: 1, hourlyLimit: 60, latestCreatedAt, now, cooldownMs: 60_000, replay: true })).toBeUndefined();
  });

  it('gates decisions on confidence, quality and conflict', () => {
    const service = new PipelineThresholdService({ minConfidence: 60 } as never);
    const output = { confidence: 75, dataQuality: 'GOOD', conflictLevel: 'LOW' };
    expect(service.evaluate(output as never)).toEqual({ actionable: true });
    expect(service.evaluate({ ...output, confidence: 59 } as never)).toEqual({ actionable: false, reason: 'CONFIDENCE_BELOW_THRESHOLD' });
    expect(service.evaluate({ ...output, dataQuality: 'PARTIAL' } as never)).toEqual({ actionable: false, reason: 'DATA_QUALITY_NOT_GOOD' });
    expect(service.evaluate({ ...output, conflictLevel: 'HIGH' } as never)).toEqual({ actionable: false, reason: 'HIGH_CONFLICT' });
  });

  it('uses bounded exponential retry settings for safe research jobs', () => {
    expect(FULL_ANALYSIS_DECISION.retryPolicy).toEqual({ attempts: 2, backoffMs: 5000 });
    expect(FULL_ANALYSIS_DECISION.steps.at(-1)?.type).toBe('DECISION');
  });

  it('uses BullMQ-safe pipeline queue names', () => {
    expect([PIPELINE_RUN_QUEUE_NAME, PIPELINE_RETRY_QUEUE_NAME, PIPELINE_DEAD_LETTER_QUEUE_NAME]).toEqual([
      'pipeline-run',
      'pipeline-retry',
      'pipeline-dead-letter',
    ]);
    expect([PIPELINE_RUN_QUEUE_NAME, PIPELINE_RETRY_QUEUE_NAME, PIPELINE_DEAD_LETTER_QUEUE_NAME].every((name) => !name.includes(':'))).toBe(true);
  });

  it('does not stamp a schedule as triggered when every enqueue attempt fails', async () => {
    const prisma = {
      pipelineSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'schedule-1',
            userId: 'user-1',
            pipelineId: 'FULL_ANALYSIS_DECISION',
            symbols: ['BTC-USDT'],
            strategyIds: ['ai-core'],
            provider: 'BINANCE_FUTURES',
            mode: 'INTERVAL',
            intervalMs: 300_000,
            lastTriggeredAt: undefined,
            timezone: 'UTC',
            maxRunsPerHour: 12,
          },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const pipeline = {
      trigger: vi.fn().mockRejectedValue(new Error('queue down')),
    };
    const service = new PipelineSchedulerService(prisma as never, pipeline as never, { enabled: true } as never);

    await service.tick(new Date('2026-08-03T09:30:00Z'));

    expect(pipeline.trigger).toHaveBeenCalledTimes(1);
    expect(prisma.pipelineSchedule.update).not.toHaveBeenCalled();
  });
});
