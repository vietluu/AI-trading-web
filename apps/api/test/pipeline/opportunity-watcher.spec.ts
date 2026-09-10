import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PipelineSchedulerService } from '../../src/modules/pipeline/application/pipeline-scheduler.service';
import { OpportunityWatcherService } from '../../src/modules/pipeline/application/opportunity-watcher.service';

describe('OpportunityWatcherService', () => {
  it('persists one opportunity transition for a duplicate candle cutoff', async () => {
    const cutoff = new Date('2026-09-09T01:00:00.000Z');
    const snapshot = {
      symbol: 'BTC-USDT',
      provider: 'BINANCE_FUTURES',
      timeframe: '15m',
      sourceDataCutoff: cutoff.toISOString(),
      schemaVersion: 1,
      calculationVersion: 2,
      eligibility: { status: 'ELIGIBLE', reasons: [] },
      structure: {
        coverage: 'AVAILABLE',
        distanceToNearestBoundaryAtr: 0.5,
        invalidationCandidates: [{ direction: 'LONG', price: 90, reason: 'RANGE_LOW' }],
        liquiditySweep: { coverage: 'UNAVAILABLE' },
      },
      volatility: {
        coverage: 'AVAILABLE',
        atr: 10,
        squeezeState: 'SQUEEZING',
        squeezeDurationCandles: 4,
      },
      momentum: {
        coverage: 'AVAILABLE',
        momentumState: 'ACCELERATING',
        macd: { histogram: 0.5 },
      },
      participation: { coverage: 'AVAILABLE', volumeState: 'EXPANDING' },
      derivatives: {
        coverage: 'AVAILABLE',
        derivativesImbalance: {
          coverage: 'AVAILABLE',
          squeezeProbability: 70,
          squeezeDirection: 'SHORT_SQUEEZE',
        },
      },
      execution: {
        coverage: 'AVAILABLE',
        currentPrice: 98,
        priceTooFarFromCandidateZones: false,
      },
    };
    const opportunity = {
      id: 'opportunity-1',
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'BTC-USDT',
      timeframe: '15m',
      setup: 'SQUEEZE_PROBE',
      direction: 'LONG',
      state: 'OBSERVING',
      invalidationPrice: 90,
      expiresAt: new Date('2026-09-09T05:00:00.000Z'),
      lastObservedCutoff: null,
      thesisVersion: 1,
      idempotencyKey: 'setup-key',
    };
    const transitions: unknown[] = [];
    const prisma = {
      anticipatoryMarketSnapshot: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'snapshot-1' }),
      },
      opportunity: {
        findFirst: vi.fn().mockImplementation(() => Promise.resolve(opportunity)),
        create: vi.fn(),
        update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          Object.assign(opportunity, data);
          return Promise.resolve(opportunity);
        }),
      },
      opportunityTransition: {
        upsert: vi.fn().mockImplementation(({ create }: { create: unknown }) => {
          transitions.push(create);
          return Promise.resolve(create);
        }),
      },
      $transaction: vi.fn().mockImplementation((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    const snapshotService = { build: vi.fn().mockResolvedValue(snapshot) };
    const watcher = new OpportunityWatcherService(prisma as never, snapshotService as never);
    const input = {
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'BTC-USDT',
      timeframe: '15m',
      sourceDataCutoff: cutoff,
      now: new Date('2026-09-09T01:00:01.000Z'),
    } as const;

    const first = await watcher.observe(input as never);
    const duplicate = await watcher.observe(input as never);

    expect(first).toMatchObject({ state: 'WATCHING', duplicate: false });
    expect(duplicate).toMatchObject({ state: 'WATCHING', duplicate: true });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      opportunityId: 'opportunity-1',
      snapshotId: 'snapshot-1',
      fromState: 'OBSERVING',
      toState: 'WATCHING',
      reasonCode: 'SQUEEZE_SETUP_FORMING',
      sourceDataCutoff: cutoff,
    });
  });
});

describe('PipelineSchedulerService observe-mode isolation', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('contains watcher failure and still dispatches the existing pipeline after a closed primary candle', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const cutoff = new Date('2026-09-09T01:00:00.000Z');
    const schedule = {
      id: 'schedule-1',
      userId: 'user-1',
      pipelineId: 'FULL_ANALYSIS_DECISION',
      symbols: ['BTC-USDT'],
      strategyIds: ['trend'],
      provider: 'BINANCE_FUTURES',
      mode: 'INTERVAL',
      intervalMs: 900_000,
      lastTriggeredAt: undefined,
      timezone: 'UTC',
      maxRunsPerHour: 12,
    };
    const prisma = {
      pipelineSchedule: {
        findMany: vi.fn().mockResolvedValue([schedule]),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const pipeline = { trigger: vi.fn().mockResolvedValue({ id: 'run-1' }) };
    const scanner = {
      reserveAnchor: vi.fn().mockResolvedValue({
        run: true,
        fingerprint: 'closed-candle',
        sourceDataCutoff: cutoff,
      }),
    };
    const watcher = { observe: vi.fn().mockRejectedValue(new Error('observe unavailable')) };
    const scheduler = new PipelineSchedulerService(
      prisma as never,
      pipeline as never,
      { enabled: true } as never,
      undefined,
      scanner as never,
      undefined,
      watcher as never,
    );

    await scheduler.tick(new Date('2026-09-09T01:00:01.000Z'));

    expect(watcher.observe).toHaveBeenCalledWith({
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'BTC-USDT',
      timeframe: '15m',
      sourceDataCutoff: cutoff,
    });
    expect(pipeline.trigger).toHaveBeenCalledTimes(1);
    expect(prisma.pipelineSchedule.update).toHaveBeenCalledTimes(1);
  });

  it('does not observe when the scheduler cannot prove a closed primary candle cutoff', async () => {
    const schedule = {
      id: 'schedule-1', userId: 'user-1', pipelineId: 'FULL_ANALYSIS_DECISION',
      symbols: ['BTC-USDT'], strategyIds: ['trend'], provider: 'BINANCE_FUTURES',
      mode: 'INTERVAL', intervalMs: 900_000, lastTriggeredAt: undefined,
      timezone: 'UTC', maxRunsPerHour: 12,
    };
    const prisma = {
      pipelineSchedule: {
        findMany: vi.fn().mockResolvedValue([schedule]),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const pipeline = { trigger: vi.fn().mockResolvedValue({ id: 'run-1' }) };
    const scanner = { reserveAnchor: vi.fn().mockResolvedValue({ run: true }) };
    const watcher = { observe: vi.fn() };
    const scheduler = new PipelineSchedulerService(
      prisma as never,
      pipeline as never,
      { enabled: true } as never,
      undefined,
      scanner as never,
      undefined,
      watcher as never,
    );

    await scheduler.tick(new Date('2026-09-09T01:00:01.000Z'));

    expect(watcher.observe).not.toHaveBeenCalled();
    expect(pipeline.trigger).toHaveBeenCalledTimes(1);
  });
});
