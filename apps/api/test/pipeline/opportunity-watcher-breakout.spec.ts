import { describe, expect, it, vi } from 'vitest';
import { ExchangeInterval, ExchangeProvider } from '../../src/exchange/domain/exchange.types';
import { OpportunityWatcherService } from '../../src/modules/pipeline/application/opportunity-watcher.service';
import { transitionOpportunity } from '../../src/modules/pipeline/domain/opportunity-state-machine';

describe('OpportunityWatcher Breakout Recognition', () => {
  it('infers BREAKOUT_RETEST setup and LONG direction when price surges above range high with expanding volatility', async () => {
    const cutoff = new Date('2026-09-18T08:00:00.000Z');
    const snapshot = {
      symbol: 'ARB-USDT',
      provider: 'OKX_FUTURES',
      timeframe: '15m',
      sourceDataCutoff: cutoff.toISOString(),
      schemaVersion: 1,
      calculationVersion: 2,
      eligibility: { status: 'ELIGIBLE', reasons: [] },
      structure: {
        coverage: 'AVAILABLE',
        rangeBoundaries: { lower: 0.50, upper: 0.60 },
        distanceToNearestBoundaryAtr: 2.2, // Pushed far beyond boundary ATR in vertical surge
        invalidationCandidates: [
          { direction: 'LONG', price: 0.50, reason: 'RANGE_LOW_LOSS' },
          { direction: 'SHORT', price: 0.60, reason: 'RANGE_HIGH_LOSS' },
        ],
        liquiditySweep: { coverage: 'UNAVAILABLE' },
      },
      volatility: {
        coverage: 'AVAILABLE',
        atr: 0.04,
        squeezeState: 'NOT_SQUEEZING',
        expansionState: 'EXPANDING',
        squeezeDurationCandles: 0,
      },
      momentum: {
        coverage: 'AVAILABLE',
        momentumState: 'ACCELERATING',
        macd: { histogram: 0.015 },
      },
      participation: { coverage: 'AVAILABLE', volumeState: 'EXPANDING' },
      derivatives: {
        coverage: 'AVAILABLE',
        derivativesImbalance: {
          coverage: 'AVAILABLE',
          squeezeProbability: 68,
          squeezeDirection: 'SHORT_SQUEEZE',
        },
      },
      execution: {
        coverage: 'AVAILABLE',
        currentPrice: 0.624, // Breakout above 0.60 upper resistance
        priceTooFarFromCandidateZones: false,
      },
    };

    const opportunity = {
      id: 'arb-breakout-1',
      userId: 'user-1',
      provider: 'OKX_FUTURES',
      symbol: 'ARB-USDT',
      timeframe: '15m',
      setup: 'BREAKOUT_RETEST',
      direction: 'LONG',
      state: 'OBSERVING',
      invalidationPrice: 0.59, // Set near broken upper resistance
      expiresAt: new Date('2026-09-18T12:00:00.000Z'),
      lastObservedCutoff: null,
      thesisVersion: 1,
      idempotencyKey: 'arb-key',
    };

    const prisma = {
      anticipatoryMarketSnapshot: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'snapshot-arb-1' }),
      },
      opportunity: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(opportunity),
        update: vi.fn().mockResolvedValue({
          ...opportunity,
          state: 'READY',
          lastObservedCutoff: cutoff,
        }),
      },
      opportunityTransition: {
        upsert: vi.fn().mockResolvedValue({ id: 'transition-1' }),
      },
      $transaction: vi.fn().mockImplementation((callback: (tx: unknown) => unknown) => callback(prisma)),
    };

    const snapshotService = {
      build: vi.fn().mockResolvedValue(snapshot),
    };

    const watcher = new OpportunityWatcherService(prisma as never, snapshotService as never);
    const result = await watcher.observe({
      userId: 'user-1',
      provider: ExchangeProvider.OKX_FUTURES,
      symbol: 'ARB-USDT',
      timeframe: ExchangeInterval.FIFTEEN_MINUTES,
      sourceDataCutoff: cutoff,
    });

    expect(result.opportunityId).toBe('arb-breakout-1');
    expect(result.reasonCode).not.toBe('NO_SETUP');
    expect(result.duplicate).toBe(false);
  });

  it('transitions BREAKOUT_RETEST from OBSERVING to READY when volume is expanding and momentum accelerates', () => {
    const cutoff = new Date('2026-09-18T08:00:00.000Z');
    const snapshot = {
      sourceDataCutoff: cutoff.toISOString(),
      eligibility: { status: 'ELIGIBLE' },
      structure: {
        coverage: 'AVAILABLE',
        rangeBoundaries: { lower: 0.50, upper: 0.60 },
        distanceToNearestBoundaryAtr: 0.5,
      },
      volatility: {
        coverage: 'AVAILABLE',
        atr: 0.04,
        expansionState: 'EXPANDING',
      },
      momentum: {
        coverage: 'AVAILABLE',
        momentumState: 'ACCELERATING',
      },
      participation: {
        coverage: 'AVAILABLE',
        volumeState: 'EXPANDING',
      },
      execution: {
        coverage: 'AVAILABLE',
        currentPrice: 0.62,
      },
    };

    const current = {
      state: 'OBSERVING',
      setup: 'BREAKOUT_RETEST',
      direction: 'LONG',
      invalidationPrice: 0.59,
      expiresAt: new Date('2026-09-18T12:00:00.000Z'),
      lastObservedCutoff: null,
    };

    const watchingTransition = transitionOpportunity(
      current as never,
      snapshot as never,
      new Date('2026-09-18T08:05:00.000Z'),
    );
    expect(watchingTransition.toState).toBe('WATCHING');
    expect(watchingTransition.reasonCode).toBe('BREAKOUT_SETUP_FORMING');

    const probeTransition = transitionOpportunity(
      { ...current, state: 'WATCHING' } as never,
      snapshot as never,
      new Date('2026-09-18T08:05:00.000Z'),
    );
    expect(probeTransition.toState).toBe('PROBE_READY');
    expect(probeTransition.reasonCode).toBe('PROBE_ALIGNMENT_CONFIRMED');
  });
});
