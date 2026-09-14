import { describe, expect, it } from 'vitest';
import type { AnticipatoryMarketSnapshot } from '@platform/shared';

import {
  transitionOpportunity,
  type OpportunityObservationState,
} from '../../src/modules/pipeline/domain/opportunity-state-machine';

const cutoff = '2026-09-09T01:00:00.000Z';

function snapshot(
  overrides: Partial<AnticipatoryMarketSnapshot> = {},
): AnticipatoryMarketSnapshot {
  return {
    symbol: 'BTC-USDT',
    provider: 'BINANCE_FUTURES',
    timeframe: '15m',
    sourceDataCutoff: cutoff,
    schemaVersion: 1,
    calculationVersion: 2,
    eligibility: { status: 'ELIGIBLE', reasons: [] },
    structure: {
      coverage: 'AVAILABLE',
      freshness: 'FRESH',
      observationAgeMs: 0,
      freshnessThresholdMs: 900_000,
      sourceTimestamp: cutoff,
      calculationVersion: 2,
      evidence: [],
      confirmedPivots: [],
      rangeBoundaries: { lower: 90, upper: 110 },
      equalHighs: [],
      equalLows: [],
      distanceToNearestBoundaryAtr: 0.5,
      invalidationCandidates: [
        { direction: 'LONG', price: 90, reason: 'RANGE_LOW_BROKEN' },
      ],
      liquiditySweep: {
        coverage: 'UNAVAILABLE',
        freshness: 'UNAVAILABLE',
        observationAgeMs: null,
        unavailableFields: ['structure.liquiditySweep'],
        reason: 'NO_CONFIRMED_SWEEP',
      },
    },
    volatility: {
      coverage: 'AVAILABLE',
      freshness: 'FRESH',
      observationAgeMs: 0,
      freshnessThresholdMs: 900_000,
      sourceTimestamp: cutoff,
      calculationVersion: 2,
      evidence: [],
      atr: 10,
      atrPercentile: 20,
      squeezeState: 'SQUEEZING',
      squeezeDurationCandles: 4,
      compressionSlope: -0.1,
      expansionState: 'NOT_EXPANDED',
    },
    momentum: {
      coverage: 'AVAILABLE',
      freshness: 'FRESH',
      observationAgeMs: 0,
      freshnessThresholdMs: 900_000,
      sourceTimestamp: cutoff,
      calculationVersion: 2,
      evidence: [],
      rsi: 56,
      macd: { value: 1, signal: 0.5, histogram: 0.5 },
      pivotOscillators: [],
      momentumState: 'ACCELERATING',
    },
    participation: {
      coverage: 'AVAILABLE',
      freshness: 'FRESH',
      observationAgeMs: 0,
      freshnessThresholdMs: 900_000,
      sourceTimestamp: cutoff,
      calculationVersion: 2,
      evidence: [],
      volumeState: 'EXPANDING',
      volumeRatio: 1.4,
      orderBook: {
        coverage: 'UNAVAILABLE',
        freshness: 'UNAVAILABLE',
        observationAgeMs: null,
        unavailableFields: ['participation.orderBook'],
        reason: 'ORDER_BOOK_UNAVAILABLE',
      },
    },
    derivatives: {
      coverage: 'AVAILABLE',
      freshness: 'FRESH',
      observationAgeMs: 0,
      freshnessThresholdMs: 900_000,
      sourceTimestamp: cutoff,
      calculationVersion: 2,
      evidence: [],
      fundingRate: 0.001,
      fundingRatePercentile: 60,
      openInterest: 1_000,
      openInterestChangePct: 4,
      priceOpenInterestDivergence: 'OI_RISING_PRICE_FLAT',
      liquidationContext: {
        coverage: 'UNAVAILABLE',
        freshness: 'UNAVAILABLE',
        observationAgeMs: null,
        unavailableFields: ['derivatives.liquidationContext'],
        reason: 'LIQUIDATIONS_UNAVAILABLE',
      },
      derivativesImbalance: {
        coverage: 'AVAILABLE',
        freshness: 'FRESH',
        observationAgeMs: 0,
        freshnessThresholdMs: 900_000,
        sourceTimestamp: cutoff,
        calculationVersion: 2,
        evidence: [],
        fundingExtreme: 'NORMAL',
        oiPriceDivergence: 'OI_RISING_PRICE_FLAT',
        squeezeProbability: 70,
        squeezeDirection: 'SHORT_SQUEEZE',
        signals: ['positioning aligns'],
      },
    },
    context: {
      coverage: 'UNAVAILABLE',
      freshness: 'UNAVAILABLE',
      observationAgeMs: null,
      unavailableFields: ['context'],
      reason: 'OPTIONAL_CONTEXT_UNAVAILABLE',
    },
    execution: {
      coverage: 'AVAILABLE',
      freshness: 'FRESH',
      observationAgeMs: 0,
      freshnessThresholdMs: 900_000,
      sourceTimestamp: cutoff,
      calculationVersion: 2,
      evidence: [],
      currentPrice: 98,
      spread: 0.05,
      estimatedRoundTripCost: 0.1,
      tickSize: 0.1,
      lotSize: 0.001,
      currentExposure: 0,
      priceTooFarFromCandidateZones: false,
    },
    ...overrides,
  };
}

function current(
  overrides: Partial<OpportunityObservationState> = {},
): OpportunityObservationState {
  return {
    state: 'OBSERVING',
    setup: 'SQUEEZE_PROBE',
    direction: 'LONG',
    invalidationPrice: 90,
    expiresAt: new Date('2026-09-09T04:00:00.000Z'),
    lastObservedCutoff: new Date('2026-09-09T00:45:00.000Z'),
    ...overrides,
  };
}

describe('transitionOpportunity', () => {
  it.each([
    {
      name: 'promotes an eligible compression setup from OBSERVING to WATCHING',
      current: current(),
      snapshot: snapshot(),
      now: new Date('2026-09-09T01:00:01.000Z'),
      toState: 'WATCHING',
      reasonCode: 'SQUEEZE_SETUP_FORMING',
    },
    {
      name: 'promotes aligned evidence from WATCHING to PROBE_READY',
      current: current({ state: 'WATCHING' }),
      snapshot: snapshot(),
      now: new Date('2026-09-09T01:00:01.000Z'),
      toState: 'PROBE_READY',
      reasonCode: 'PROBE_ALIGNMENT_CONFIRMED',
    },
    {
      name: 'expires a thesis at its declared deadline',
      current: current({ state: 'WATCHING' }),
      snapshot: snapshot(),
      now: new Date('2026-09-09T04:00:00.000Z'),
      toState: 'EXPIRED',
      reasonCode: 'OPPORTUNITY_EXPIRED',
    },
    {
      name: 'invalidates a long thesis below its structural invalidation',
      current: current({ state: 'WATCHING' }),
      snapshot: snapshot({
        execution: {
          ...snapshot().execution,
          currentPrice: 89,
        } as AnticipatoryMarketSnapshot['execution'],
      }),
      now: new Date('2026-09-09T01:00:01.000Z'),
      toState: 'INVALIDATED',
      reasonCode: 'STRUCTURAL_INVALIDATION',
    },
    {
      name: 'rejects a chase after price leaves the candidate zone',
      current: current({ state: 'WATCHING' }),
      snapshot: snapshot({
        execution: {
          ...snapshot().execution,
          priceTooFarFromCandidateZones: true,
        } as AnticipatoryMarketSnapshot['execution'],
      }),
      now: new Date('2026-09-09T01:00:01.000Z'),
      toState: 'TOO_LATE',
      reasonCode: 'PRICE_BEYOND_CHASE_LIMIT',
    },
  ])('$name', ({ current: state, snapshot: market, now, toState, reasonCode }) => {
    expect(transitionOpportunity(state, market, now)).toMatchObject({
      changed: true,
      fromState: state.state,
      toState,
      reasonCode,
      sourceDataCutoff: new Date(cutoff),
    });
  });

  it('treats an already-observed candle cutoff as an idempotent no-op', () => {
    const state = current({
      state: 'WATCHING',
      lastObservedCutoff: new Date(cutoff),
    });

    expect(transitionOpportunity(state, snapshot(), new Date('2026-09-09T01:01:00.000Z')))
      .toEqual({
        changed: false,
        fromState: 'WATCHING',
        toState: 'WATCHING',
        reasonCode: 'DUPLICATE_CANDLE_CUTOFF',
        sourceDataCutoff: new Date(cutoff),
      });
  });

  it.each(['INVALIDATED', 'EXPIRED', 'TOO_LATE'] as const)(
    'keeps terminal state %s terminal',
    (state) => {
      expect(transitionOpportunity(
        current({ state, lastObservedCutoff: new Date('2026-09-09T00:30:00.000Z') }),
        snapshot(),
        new Date('2026-09-09T01:01:00.000Z'),
      )).toMatchObject({
        changed: false,
        fromState: state,
        toState: state,
        reasonCode: 'TERMINAL_STATE',
      });
    },
  );

  it('promotes LIQUIDITY_SWEEP_REVERSAL from WATCHING to PROBE_READY when sweep is reclaimed', () => {
    const sweepSnapshot = snapshot({
      structure: {
        ...snapshot().structure,
        liquiditySweep: {
          coverage: 'AVAILABLE',
          freshness: 'FRESH',
          observationAgeMs: 0,
          freshnessThresholdMs: 900_000,
          sourceTimestamp: cutoff,
          calculationVersion: 2,
          evidence: [{ snapshotField: 'structure.liquiditySweep', source: 'BINANCE_FUTURES', sourceTimestamp: cutoff, calculationVersion: 2 }],
          detected: true,
          direction: 'BULLISH_SWEEP',
          sweepZone: { price: 90, type: 'SWING_LOW' },
          penetration: 1.5,
          reclaimed: true,
        },
      },
    });
    const state = current({
      setup: 'LIQUIDITY_SWEEP_REVERSAL',
      state: 'WATCHING',
      direction: 'LONG',
      invalidationPrice: 88,
    });

    const result = transitionOpportunity(state, sweepSnapshot, new Date('2026-09-09T01:00:01.000Z'));
    expect(result).toMatchObject({
      changed: true,
      fromState: 'WATCHING',
      toState: 'PROBE_READY',
      reasonCode: 'PROBE_ALIGNMENT_CONFIRMED',
      sourceDataCutoff: new Date(cutoff),
    });
  });
});
