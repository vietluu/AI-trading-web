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

  it('rejects opposite direction transition at the same candle cutoff as CONDITIONS_UNCHANGED', async () => {
    const cutoff = new Date('2026-09-09T01:00:00.000Z');
    const snapshotLong = {
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
        liquiditySweep: { coverage: 'AVAILABLE', detected: true, direction: 'BULLISH_SWEEP', reclaimed: true },
      },
      volatility: { coverage: 'AVAILABLE', atr: 10, squeezeState: 'NOT_SQUEEZING', squeezeDurationCandles: 0 },
      momentum: { coverage: 'AVAILABLE', momentumState: 'ACCELERATING', macd: { histogram: 0.5 } },
      participation: { coverage: 'AVAILABLE', volumeState: 'EXPANDING' },
      derivatives: { coverage: 'UNAVAILABLE' },
      execution: { coverage: 'AVAILABLE', currentPrice: 98, priceTooFarFromCandidateZones: false },
    };
    const snapshotShort = {
      ...snapshotLong,
      structure: {
        ...snapshotLong.structure,
        liquiditySweep: { coverage: 'AVAILABLE', detected: true, direction: 'BEARISH_SWEEP', reclaimed: true },
      },
      momentum: { coverage: 'AVAILABLE', momentumState: 'ACCELERATING', macd: { histogram: -0.5 } },
    };

    const opportunity = {
      id: 'opportunity-2',
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'BTC-USDT',
      timeframe: '15m',
      setup: 'LIQUIDITY_SWEEP_REVERSAL',
      direction: 'LONG',
      state: 'WATCHING',
      invalidationPrice: 90,
      expiresAt: new Date('2026-09-09T05:00:00.000Z'),
      lastObservedCutoff: cutoff,
      thesisVersion: 1,
      idempotencyKey: 'setup-key-2',
    };
    const transitions: unknown[] = [];
    const prisma = {
      anticipatoryMarketSnapshot: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'snapshot-2' }),
      },
      opportunity: {
        findFirst: vi.fn().mockResolvedValue(opportunity),
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
    const snapshotService = { build: vi.fn().mockResolvedValue(snapshotShort) };
    const watcher = new OpportunityWatcherService(prisma as never, snapshotService as never);

    const result = await watcher.observe({
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'BTC-USDT',
      timeframe: '15m',
      sourceDataCutoff: cutoff,
      now: new Date('2026-09-09T01:00:01.000Z'),
    } as never);

    expect(result).toMatchObject({
      opportunityId: 'opportunity-2',
      state: 'WATCHING',
      duplicate: true,
      reasonCode: 'DUPLICATE_CANDLE_CUTOFF',
    });
    expect(transitions).toHaveLength(0);
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

  it('triggers proactive-thesis pipeline when an opportunity first enters WATCHING, while skipping duplicate or terminal observations', async () => {
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
    const watcher = {
      observe: vi.fn().mockResolvedValue({
        state: 'WATCHING',
        duplicate: false,
        opportunityId: 'opp-1',
        snapshotId: 'snapshot-1',
        reasonCode: 'SQUEEZE_SETUP_FORMING',
      }),
    };
    const scheduler = new PipelineSchedulerService(
      prisma as never,
      pipeline as never,
      { enabled: true } as never,
      undefined,
      scanner as never,
      undefined,
      watcher as never,
    );

    // 1. First transition to WATCHING triggers both normal pipeline and proactive-thesis
    await scheduler.tick(new Date('2026-09-09T01:00:01.000Z'));

    expect(watcher.observe).toHaveBeenCalledTimes(1);
    expect(pipeline.trigger).toHaveBeenCalledTimes(2);
    expect(pipeline.trigger).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        pipelineId: 'proactive-thesis',
        symbol: 'BTC-USDT',
        provider: 'BINANCE_FUTURES',
        params: expect.objectContaining({
          interval: '15m',
          opportunityId: 'opp-1',
          snapshotId: 'snapshot-1',
          sourceDataCutoff: cutoff.toISOString(),
        }) as unknown,
      }),
      'SCHEDULE',
      expect.objectContaining({
        scheduleId: 'schedule-1',
        bypassCooldown: true,
        storedContext: expect.objectContaining({
          opportunityId: 'opp-1',
          snapshotId: 'snapshot-1',
          sourceDataCutoff: cutoff.toISOString(),
        }) as unknown,
      }),
    );
    expect(pipeline.trigger).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        pipelineId: 'FULL_ANALYSIS_DECISION',
        symbol: 'BTC-USDT',
      }),
      'SCHEDULE',
      expect.objectContaining({
        scheduleId: 'schedule-1',
      }),
    );

    // 2. Duplicate observation does NOT trigger proactive-thesis
    pipeline.trigger.mockClear();
    watcher.observe.mockResolvedValueOnce({
      state: 'WATCHING',
      duplicate: true,
      opportunityId: 'opp-1',
      snapshotId: 'snapshot-1',
      reasonCode: 'DUPLICATE_CANDLE_CUTOFF',
    });
    await scheduler.tick(new Date('2026-09-09T01:15:01.000Z'));
    expect(pipeline.trigger).toHaveBeenCalledTimes(1);
    expect(pipeline.trigger).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pipelineId: 'proactive-thesis' }),
      expect.anything(),
      expect.anything(),
    );

    // 3. Terminal observation (e.g. EXPIRED) does NOT trigger proactive-thesis
    pipeline.trigger.mockClear();
    watcher.observe.mockResolvedValueOnce({
      state: 'EXPIRED',
      duplicate: false,
      opportunityId: 'opp-1',
      snapshotId: 'snapshot-1',
      reasonCode: 'TIME_DECAY_EXCEEDED',
    });
    await scheduler.tick(new Date('2026-09-09T01:30:01.000Z'));
    expect(pipeline.trigger).toHaveBeenCalledTimes(1);
    expect(pipeline.trigger).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pipelineId: 'proactive-thesis' }),
      expect.anything(),
      expect.anything(),
    );
  });
});

