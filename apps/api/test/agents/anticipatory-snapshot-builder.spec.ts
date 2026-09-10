import { describe, expect, it } from 'vitest';

import { AnticipatoryMarketSnapshotSchema } from '@platform/shared';

import {
  buildAnticipatoryMarketSnapshot,
  type AnticipatoryCandleInput,
  type AnticipatorySnapshotInput,
} from '../../src/modules/agents/domain/analysis/anticipatory-snapshot-builder';

const startMs = Date.parse('2026-09-09T00:00:00.000Z');

function candle(
  index: number,
  high: number,
  low: number,
  close: number,
  volume: number = 100,
): AnticipatoryCandleInput {
  return {
    openTime: new Date(startMs + index * 60_000).toISOString(),
    closeTime: new Date(startMs + (index + 1) * 60_000).toISOString(),
    open: close,
    high,
    low,
    close,
    volume,
    isClosed: true,
  };
}

function inputFixture(): AnticipatorySnapshotInput {
  const candles = [
    candle(0, 100, 90, 95),
    candle(1, 102, 89, 96),
    candle(2, 110, 88, 105),
    candle(3, 103, 87, 98),
    candle(4, 104, 80, 90),
    candle(5, 103, 86, 97),
    candle(6, 108, 85, 102),
    candle(7, 104, 86, 100),
    // This future right-hand bar invalidates index 6 as a pivot high. It must
    // not make index 6 visible or confirmed in a snapshot cut at index 7.
    candle(8, 109, 87, 106, 500),
    candle(9, 103, 86, 98),
  ];

  return {
    symbol: 'BTC-USDT',
    provider: 'BINANCE_FUTURES',
    timeframe: '1m',
    sourceDataCutoff: candles[7]!.closeTime,
    schemaVersion: 1,
    calculationVersion: 2,
    freshnessThresholdMs: 60_000,
    pivotStrength: 2,
    candles,
    rsiHistory: candles.map((item, index) => ({
      timestamp: item.closeTime,
      value: [45, 50, 72, 51, 28, 48, 68, 55, 5, 99][index]!,
    })),
    macdHistory: candles.map((item, index) => ({
      timestamp: item.closeTime,
      value: index / 10,
      signal: index / 20,
      histogram: [0, 0.2, 2.5, 0.5, -2.2, -0.4, 1.7, 0.3, -9, 12][index]!,
    })),
    atrHistory: candles.map((item, index) => ({
      timestamp: item.closeTime,
      value: [2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4, 999, 999][index]!,
    })),
    execution: {
      timestamp: candles[7]!.closeTime,
      spread: 0.1,
      estimatedRoundTripCost: 0.2,
      tickSize: 0.1,
      lotSize: 0.001,
      currentExposure: 0,
      maximumChaseDistanceAtr: 0.8,
    },
  };
}

function addValidDerivatives(input: AnticipatorySnapshotInput): string[] {
  const signals = ['Position building'];
  input.derivatives = {
    timestamp: input.candles[7]!.closeTime,
    fundingRate: 0.01,
    fundingHistory: input.candles.slice(1, 7).map((item, index) => ({
      timestamp: item.closeTime,
      value: index / 10_000,
    })),
    openInterest: 110,
    openInterestHistory: [
      { timestamp: input.candles[6]!.closeTime, value: 100 },
      { timestamp: input.candles[7]!.closeTime, value: 110 },
    ],
    priceOpenInterestDivergence: 'OI_RISING_PRICE_FLAT',
    derivativesImbalance: {
      timestamp: input.candles[7]!.closeTime,
      fundingExtreme: 'NORMAL',
      oiPriceDivergence: 'OI_RISING_PRICE_FLAT',
      squeezeProbability: 40,
      squeezeDirection: 'NONE',
      signals,
    },
  };
  return signals;
}

describe('buildAnticipatoryMarketSnapshot', () => {
  it('cannot see candles or oscillator observations after the source cutoff', () => {
    const withFutureData = inputFixture();
    withFutureData.candles[8] = {
      ...withFutureData.candles[8]!,
      high: Number.NaN,
    };
    withFutureData.atrHistory![8] = {
      ...withFutureData.atrHistory![8]!,
      value: Number.NaN,
    };
    const withoutFutureData = {
      ...withFutureData,
      candles: withFutureData.candles.slice(0, 8),
      rsiHistory: withFutureData.rsiHistory!.slice(0, 8),
      macdHistory: withFutureData.macdHistory!.slice(0, 8),
      atrHistory: withFutureData.atrHistory!.slice(0, 8),
    };

    const snapshot = buildAnticipatoryMarketSnapshot(withFutureData);
    const control = buildAnticipatoryMarketSnapshot(withoutFutureData);

    expect(snapshot).toEqual(control);
    expect(AnticipatoryMarketSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.structure.coverage).toBe('AVAILABLE');
    if (snapshot.structure.coverage === 'AVAILABLE') {
      expect(snapshot.structure.confirmedPivots).toEqual([
        {
          kind: 'HIGH',
          price: 110,
          occurredAt: withFutureData.candles[2]!.closeTime,
          confirmedAt: withFutureData.candles[4]!.closeTime,
        },
        {
          kind: 'LOW',
          price: 80,
          occurredAt: withFutureData.candles[4]!.closeTime,
          confirmedAt: withFutureData.candles[6]!.closeTime,
        },
      ]);
    }
    expect(JSON.stringify(snapshot)).not.toContain(withFutureData.candles[8].closeTime);
    expect(snapshot.volatility.coverage).toBe('AVAILABLE');
    if (snapshot.volatility.coverage === 'AVAILABLE') {
      expect(snapshot.volatility.atr).toBe(4);
    }
  });

  it('does not fabricate ATR-normalized structure evidence when ATR is unavailable', () => {
    const input = inputFixture();
    input.atrHistory = undefined;

    const snapshot = buildAnticipatoryMarketSnapshot(input);

    expect(snapshot.structure).toMatchObject({
      coverage: 'UNAVAILABLE',
      unavailableFields: ['structure.distanceToNearestBoundaryAtr'],
    });
  });

  it('accepts historical zero ATR while current zero keeps dependent evidence unavailable', () => {
    const input = inputFixture();
    const candles = [
      ...input.candles.slice(0, 8),
      ...Array.from({ length: 22 }, (_, offset) => {
        const index = offset + 8;
        return candle(
          index,
          104 + (index % 3),
          86 - (index % 2),
          99 + (index % 2),
        );
      }),
    ];
    input.candles = candles;
    input.sourceDataCutoff = candles[29]!.closeTime;
    input.rsiHistory = candles.map((item) => ({
      timestamp: item.closeTime,
      value: 50,
    }));
    input.macdHistory = candles.map((item) => ({
      timestamp: item.closeTime,
      value: 0,
      signal: 0,
      histogram: 0,
    }));
    input.atrHistory = candles.map((item, index) => ({
      timestamp: item.closeTime,
      value: index === 0 ? 0 : 4,
    }));
    input.execution = {
      ...input.execution!,
      timestamp: candles[29]!.closeTime,
      currentPrice: 100,
      candidateZonePrices: [100],
    };

    const historicalZeroSnapshot = buildAnticipatoryMarketSnapshot(input);
    expect(historicalZeroSnapshot.structure.coverage).toBe('AVAILABLE');
    expect(historicalZeroSnapshot.volatility).toMatchObject({
      coverage: 'AVAILABLE',
      atr: 4,
    });
    expect(historicalZeroSnapshot.execution.coverage).toBe('AVAILABLE');

    const currentZeroInput: AnticipatorySnapshotInput = {
      ...input,
      atrHistory: input.atrHistory.map((point, index) => ({
        ...point,
        value: index === input.atrHistory!.length - 1 ? 0 : point.value,
      })),
    };
    const currentZeroSnapshot = buildAnticipatoryMarketSnapshot(currentZeroInput);

    expect(currentZeroSnapshot.structure).toMatchObject({
      coverage: 'UNAVAILABLE',
      unavailableFields: ['structure.distanceToNearestBoundaryAtr'],
    });
    expect(currentZeroSnapshot.volatility).toMatchObject({
      coverage: 'UNAVAILABLE',
      unavailableFields: ['volatility.atr'],
    });
    expect(currentZeroSnapshot.execution).toMatchObject({
      coverage: 'UNAVAILABLE',
      unavailableFields: ['execution.priceTooFarFromCandidateZones'],
    });
  });

  it('marks execution unavailable when ATR cannot support chase distance', () => {
    const input = inputFixture();
    input.atrHistory = undefined;

    const snapshot = buildAnticipatoryMarketSnapshot(input);

    expect(snapshot.execution).toEqual({
      coverage: 'UNAVAILABLE',
      freshness: 'UNAVAILABLE',
      observationAgeMs: null,
      unavailableFields: ['execution.priceTooFarFromCandidateZones'],
      reason: 'CHASE_DISTANCE_ATR_UNAVAILABLE',
    });
  });

  it('marks execution unavailable when candidate zones are absent', () => {
    const input = inputFixture();
    input.execution = { ...input.execution!, candidateZonePrices: [] };

    const snapshot = buildAnticipatoryMarketSnapshot(input);

    expect(snapshot.execution).toEqual({
      coverage: 'UNAVAILABLE',
      freshness: 'UNAVAILABLE',
      observationAgeMs: null,
      unavailableFields: ['execution.priceTooFarFromCandidateZones'],
      reason: 'CHASE_DISTANCE_CANDIDATE_ZONES_UNAVAILABLE',
    });
  });

  it('uses the oldest contributing core observation when evaluating freshness', () => {
    const input = inputFixture();
    input.atrHistory = [
      { timestamp: input.candles[0]!.closeTime, value: 4 },
    ];
    input.rsiHistory = [
      { timestamp: input.candles[2]!.closeTime, value: 72 },
    ];

    const snapshot = buildAnticipatoryMarketSnapshot(input);

    expect(snapshot.structure).toMatchObject({ freshness: 'STALE' });
    expect(snapshot.volatility).toMatchObject({ freshness: 'STALE' });
    expect(snapshot.momentum).toMatchObject({ freshness: 'STALE' });
    expect(snapshot.eligibility).toEqual({
      status: 'INELIGIBLE',
      reasons: ['STRUCTURE_STALE', 'VOLATILITY_STALE', 'MOMENTUM_STALE'],
    });
  });

  it('marks derivatives unavailable when cutoff filtering removes required history', () => {
    const input = inputFixture();
    const futureTimestamp = input.candles[8]!.closeTime;
    input.derivatives = {
      timestamp: input.candles[7]!.closeTime,
      fundingRate: 0.01,
      fundingHistory: Array.from({ length: 5 }, () => ({
        timestamp: futureTimestamp,
        value: 0.01,
      })),
      openInterest: 110,
      openInterestHistory: [
        { timestamp: futureTimestamp, value: 100 },
        { timestamp: futureTimestamp, value: 110 },
      ],
      priceOpenInterestDivergence: 'ALIGNED',
    };

    const snapshot = buildAnticipatoryMarketSnapshot(input);

    expect(snapshot.derivatives).toEqual({
      coverage: 'UNAVAILABLE',
      freshness: 'UNAVAILABLE',
      observationAgeMs: null,
      unavailableFields: [
        'derivatives.fundingRatePercentile',
        'derivatives.openInterestChangePct',
      ],
      reason: 'DERIVATIVES_HISTORY_INSUFFICIENT_AT_CUTOFF',
    });
  });

  it('marks derivatives unavailable when prior open interest is zero', () => {
    const input = inputFixture();
    addValidDerivatives(input);
    input.derivatives!.openInterestHistory = [
      { timestamp: input.candles[6]!.closeTime, value: 0 },
      { timestamp: input.candles[7]!.closeTime, value: 110 },
    ];

    const snapshot = buildAnticipatoryMarketSnapshot(input);

    expect(snapshot.derivatives).toEqual({
      coverage: 'UNAVAILABLE',
      freshness: 'UNAVAILABLE',
      observationAgeMs: null,
      unavailableFields: ['derivatives.openInterestChangePct'],
      reason: 'OPEN_INTEREST_PERCENTAGE_DENOMINATOR_INVALID',
    });
  });

  it.each([
    ['execution.spread', (input: AnticipatorySnapshotInput) => { input.execution!.spread = -1; }],
    ['execution.currentExposure', (input: AnticipatorySnapshotInput) => { input.execution!.currentExposure = Number.NaN; }],
    ['execution.tickSize', (input: AnticipatorySnapshotInput) => { input.execution!.tickSize = 0; }],
    ['execution.lotSize', (input: AnticipatorySnapshotInput) => { input.execution!.lotSize = Number.POSITIVE_INFINITY; }],
    ['derivatives.openInterest', (input: AnticipatorySnapshotInput) => {
      addValidDerivatives(input);
      input.derivatives!.openInterest = -1;
    }],
    ['orderBook.imbalance', (input: AnticipatorySnapshotInput) => {
      input.orderBook = {
        timestamp: input.candles[7]!.closeTime,
        imbalance: Number.POSITIVE_INFINITY,
      };
    }],
    ['context.news.freshnessThresholdMs', (input: AnticipatorySnapshotInput) => {
      input.context = {
        news: {
          source: 'REUTERS',
          freshnessThresholdMs: -1,
          observations: [
            {
              observedAt: input.candles[7]!.closeTime,
              summary: 'Scheduled market update',
            },
          ],
        },
      };
    }],
  ])('rejects invalid raw numeric input at %s', (field, mutate) => {
    const input = inputFixture();
    mutate(input);

    expect(() => buildAnticipatoryMarketSnapshot(input)).toThrowError(
      `Invalid anticipatory snapshot input: ${field}`,
    );
  });

  it('copies derivatives imbalance signals into the snapshot', () => {
    const input = inputFixture();
    const inputSignals = addValidDerivatives(input);

    const snapshot = buildAnticipatoryMarketSnapshot(input);
    expect(snapshot.derivatives.coverage).toBe('AVAILABLE');
    if (
      snapshot.derivatives.coverage === 'AVAILABLE' &&
      snapshot.derivatives.derivativesImbalance.coverage === 'AVAILABLE'
    ) {
      snapshot.derivatives.derivativesImbalance.signals.push('Output-only mutation');
    }

    expect(inputSignals).toEqual(['Position building']);
  });

  it('stores RSI and MACD values matched to confirmed pivots', () => {
    const input = inputFixture();
    const snapshot = buildAnticipatoryMarketSnapshot(input);

    expect(snapshot.momentum.coverage).toBe('AVAILABLE');
    if (snapshot.momentum.coverage === 'AVAILABLE') {
      expect(snapshot.momentum.rsi).toBe(55);
      expect(snapshot.momentum.macd.histogram).toBe(0.3);
      expect(snapshot.momentum.pivotOscillators).toEqual([
        {
          pivotOccurredAt: input.candles[2]!.closeTime,
          rsi: 72,
          macdHistogram: 2.5,
        },
        {
          pivotOccurredAt: input.candles[4]!.closeTime,
          rsi: 28,
          macdHistogram: -2.2,
        },
      ]);
    }
  });

  it('derives divergence from the most recent same-kind matched pivot pair', () => {
    const input = inputFixture();
    input.pivotStrength = 1;
    input.candles = [
      candle(0, 100, 90, 95),
      candle(1, 110, 95, 105),
      candle(2, 100, 80, 90),
      candle(3, 115, 95, 110),
      candle(4, 102, 85, 90),
      candle(5, 105, 96, 102),
      candle(6, 103, 70, 80),
      candle(7, 103, 97, 100),
      candle(8, 102, 90, 95),
    ];
    input.sourceDataCutoff = input.candles[8]!.closeTime;
    input.atrHistory = input.candles.map((item) => ({
      timestamp: item.closeTime,
      value: 4,
    }));
    input.rsiHistory = input.candles.map((item, index) => ({
      timestamp: item.closeTime,
      value: [50, 55, 25, 65, 30, 60, 40, 50, 50][index]!,
    }));
    input.macdHistory = input.candles.map((item, index) => ({
      timestamp: item.closeTime,
      value: 0,
      signal: 0,
      histogram: [0, 1, -3, 3, -2, 2, -1, 0, 0][index]!,
    }));
    input.execution = { ...input.execution!, timestamp: input.candles[8]!.closeTime };

    const snapshot = buildAnticipatoryMarketSnapshot(input);

    expect(snapshot.momentum).toMatchObject({
      coverage: 'AVAILABLE',
      momentumState: 'DECELERATING',
    });
  });

  it('derives volatility and chase evidence from only closed cutoff-safe candles', () => {
    const input = inputFixture();
    const expanded = Array.from({ length: 30 }, (_, index) =>
      candle(index, 101 + (index % 3), 99 - (index % 2), 100 + (index % 2), 100),
    );
    input.candles = expanded;
    input.sourceDataCutoff = expanded[29]!.closeTime;
    input.rsiHistory = expanded.map((item) => ({ timestamp: item.closeTime, value: 50 }));
    input.macdHistory = expanded.map((item) => ({
      timestamp: item.closeTime,
      value: 0,
      signal: 0,
      histogram: 0,
    }));
    input.atrHistory = undefined;
    input.execution = {
      ...input.execution!,
      timestamp: expanded[29]!.closeTime,
      currentPrice: 110,
      candidateZonePrices: [100],
    };

    const snapshot = buildAnticipatoryMarketSnapshot(input);

    expect(snapshot.volatility.coverage).toBe('AVAILABLE');
    if (snapshot.volatility.coverage === 'AVAILABLE') {
      expect(snapshot.volatility.atr).toBeGreaterThan(0);
      expect(snapshot.volatility.atrPercentile).toBeGreaterThanOrEqual(0);
      expect(snapshot.volatility.atrPercentile).toBeLessThanOrEqual(100);
      expect(['SQUEEZING', 'NOT_SQUEEZING']).toContain(snapshot.volatility.squeezeState);
    }
    expect(snapshot.execution.coverage).toBe('AVAILABLE');
    if (snapshot.execution.coverage === 'AVAILABLE') {
      expect(snapshot.execution.priceTooFarFromCandidateZones).toBe(true);
    }
  });
});
