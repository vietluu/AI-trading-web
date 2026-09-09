import { describe, expect, it } from 'vitest';
import type { AnticipatoryMarketSnapshot, TradeThesis } from '@platform/shared';
import { validateTradeThesis } from '../../src/modules/agents/domain/trade-thesis-validator';

const cutoff = '2026-09-09T12:00:00.000Z';
const observedAt = '2026-09-09T11:59:00.000Z';

const createBaseSnapshot = (): AnticipatoryMarketSnapshot => ({
  symbol: 'BTC-USDT',
  provider: 'BINANCE_FUTURES',
  timeframe: '15m',
  sourceDataCutoff: cutoff,
  schemaVersion: 1,
  calculationVersion: 1,
  eligibility: { status: 'ELIGIBLE', reasons: [] },
  structure: {
    coverage: 'AVAILABLE',
    freshness: 'FRESH',
    observationAgeMs: 60_000,
    freshnessThresholdMs: 300_000,
    sourceTimestamp: observedAt,
    calculationVersion: 1,
    evidence: [
      {
        snapshotField: 'structure',
        source: 'BINANCE_FUTURES',
        sourceTimestamp: observedAt,
        calculationVersion: 1,
      },
    ],
    confirmedPivots: [
      {
        kind: 'HIGH',
        price: 112_000,
        occurredAt: '2026-09-09T11:00:00.000Z',
        confirmedAt: cutoff,
      },
    ],
    rangeBoundaries: { lower: 108_000, upper: 112_000 },
    equalHighs: [112_000],
    equalLows: [108_000],
    distanceToNearestBoundaryAtr: 0.25,
    invalidationCandidates: [
      { direction: 'LONG', price: 107_750, reason: 'RANGE_LOW_LOSS' },
    ],
    liquiditySweep: {
      coverage: 'AVAILABLE',
      freshness: 'FRESH',
      observationAgeMs: 60_000,
      freshnessThresholdMs: 300_000,
      sourceTimestamp: observedAt,
      calculationVersion: 1,
      evidence: [
        {
          snapshotField: 'structure.liquiditySweep',
          source: 'BINANCE_FUTURES',
          sourceTimestamp: observedAt,
          calculationVersion: 1,
        },
      ],
      detected: false,
      direction: null,
      sweepZone: null,
      penetration: 0,
      reclaimed: false,
    },
  },
  volatility: {
    coverage: 'AVAILABLE',
    freshness: 'FRESH',
    observationAgeMs: 60_000,
    freshnessThresholdMs: 300_000,
    sourceTimestamp: observedAt,
    calculationVersion: 1,
    evidence: [
      {
        snapshotField: 'volatility',
        source: 'BINANCE_FUTURES',
        sourceTimestamp: observedAt,
        calculationVersion: 1,
      },
    ],
    atr: 200,
    atrPercentile: 25,
    squeezeState: 'SQUEEZING',
    squeezeDurationCandles: 6,
    compressionSlope: -0.1,
    expansionState: 'NOT_EXPANDED',
  },
  momentum: {
    coverage: 'AVAILABLE',
    freshness: 'FRESH',
    observationAgeMs: 60_000,
    freshnessThresholdMs: 300_000,
    sourceTimestamp: observedAt,
    calculationVersion: 1,
    evidence: [
      {
        snapshotField: 'momentum',
        source: 'BINANCE_FUTURES',
        sourceTimestamp: observedAt,
        calculationVersion: 1,
      },
    ],
    rsi: 52,
    macd: { value: 10, signal: 5, histogram: 5 },
    pivotOscillators: [],
    momentumState: 'STABLE',
  },
  participation: {
    coverage: 'AVAILABLE',
    freshness: 'FRESH',
    observationAgeMs: 60_000,
    freshnessThresholdMs: 300_000,
    sourceTimestamp: observedAt,
    calculationVersion: 1,
    evidence: [
      {
        snapshotField: 'participation',
        source: 'BINANCE_FUTURES',
        sourceTimestamp: observedAt,
        calculationVersion: 1,
      },
    ],
    volumeState: 'COMPRESSING',
    volumeRatio: 0.8,
    orderBook: {
      coverage: 'UNAVAILABLE',
      freshness: 'UNAVAILABLE',
      observationAgeMs: null,
      unavailableFields: ['participation.orderBook'],
      reason: 'UNAVAILABLE',
    },
  },
  derivatives: {
    coverage: 'AVAILABLE',
    freshness: 'FRESH',
    observationAgeMs: 60_000,
    freshnessThresholdMs: 300_000,
    sourceTimestamp: observedAt,
    calculationVersion: 1,
    evidence: [
      {
        snapshotField: 'derivatives',
        source: 'BINANCE_FUTURES',
        sourceTimestamp: observedAt,
        calculationVersion: 1,
      },
    ],
    fundingRate: 0.0001,
    fundingRatePercentile: 50,
    openInterest: 1_000_000,
    openInterestChangePct: 1.2,
    priceOpenInterestDivergence: 'ALIGNED',
    liquidationContext: {
      coverage: 'UNAVAILABLE',
      freshness: 'UNAVAILABLE',
      observationAgeMs: null,
      unavailableFields: ['derivatives.liquidationContext'],
      reason: 'UNAVAILABLE',
    },
    derivativesImbalance: {
      coverage: 'AVAILABLE',
      freshness: 'FRESH',
      observationAgeMs: 60_000,
      freshnessThresholdMs: 300_000,
      sourceTimestamp: observedAt,
      calculationVersion: 1,
      evidence: [
        {
          snapshotField: 'derivatives.derivativesImbalance',
          source: 'BINANCE_FUTURES',
          sourceTimestamp: observedAt,
          calculationVersion: 1,
        },
      ],
      fundingExtreme: 'NORMAL',
      oiPriceDivergence: 'ALIGNED',
      squeezeProbability: 10,
      squeezeDirection: 'NONE',
      signals: ['Balanced derivatives'],
    },
  },
  context: {
    coverage: 'UNAVAILABLE',
    freshness: 'UNAVAILABLE',
    observationAgeMs: null,
    unavailableFields: ['context.news', 'context.sentiment', 'context.macro', 'context.onChain'],
    reason: 'UNAVAILABLE',
  },
  execution: {
    coverage: 'AVAILABLE',
    freshness: 'FRESH',
    observationAgeMs: 60_000,
    freshnessThresholdMs: 300_000,
    sourceTimestamp: observedAt,
    calculationVersion: 1,
    evidence: [
      {
        snapshotField: 'execution',
        source: 'BINANCE_FUTURES',
        sourceTimestamp: observedAt,
        calculationVersion: 1,
      },
    ],
    currentPrice: 108_200,
    spread: 1.0,
    estimatedRoundTripCost: 3.5,
    tickSize: 0.1,
    lotSize: 0.001,
    currentExposure: 0,
    priceTooFarFromCandidateZones: false,
  },
});

const createValidLongThesis = (): TradeThesis => ({
  thesisVersion: 1,
  decisionSource: 'AI',
  state: 'PROBE_READY',
  direction: 'LONG',
  regime: 'PRE_BREAKOUT_ACCUMULATION',
  transitionProbability: 0.85,
  setup: 'RANGE_REVERSAL',
  entryZone: { lower: 108_000, upper: 108_500 },
  trigger: [
    {
      type: 'PRICE_RECLAIM',
      price: 108_250,
      description: 'Reclaim range low after sweep',
    },
  ],
  invalidation: {
    price: 107_500,
    reason: 'Loss of range low structural support',
  },
  stopLoss: 107_400,
  targets: [
    { price: 110_000, fraction: 0.5 },
    { price: 112_000, fraction: 0.5 },
  ],
  expectedNetR: 2.4,
  maximumChaseDistanceAtr: 0.6,
  confidence: 80,
  evidenceFor: [
    {
      snapshotField: 'structure',
      source: 'BINANCE_FUTURES',
      sourceTimestamp: observedAt,
      calculationVersion: 1,
    },
  ],
  evidenceAgainst: [],
  missingEvidence: [],
  expiresAt: '2026-09-09T12:30:00.000Z',
});

describe('TradeThesisValidator', () => {
  it('validates a correct LONG thesis', () => {
    const snapshot = createBaseSnapshot();
    const thesis = createValidLongThesis();

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(true);
    expect(result.status).toBe('VALID');
    expect(result.reasonCodes).toEqual([]);
    expect(result.reasons).toEqual([]);
  });

  it('rejects missing invalidation on actionable thesis with PROTECTION_REQUIRED', () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      invalidation: null,
    };

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('PROTECTION_REQUIRED');
  });

  it('rejects inverted LONG geometry when stopLoss is not below entryZone.lower', () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      entryZone: { lower: 108_000, upper: 108_500 },
      stopLoss: 108_200, // Inverted: stopLoss >= entryZone.lower
    };

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('GEOMETRY_INVALID');
  });

  it('rejects inverted SHORT geometry when stopLoss is not above entryZone.upper', () => {
    const snapshot = createBaseSnapshot();
    const thesis: TradeThesis = {
      ...createValidLongThesis(),
      direction: 'SHORT',
      entryZone: { lower: 111_500, upper: 112_000 },
      stopLoss: 111_800, // Inverted: stopLoss <= entryZone.upper
      invalidation: { price: 112_200, reason: 'Range high broken' },
      targets: [{ price: 109_000, fraction: 1.0 }],
    };

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('GEOMETRY_INVALID');
  });

  it('rejects targets fractions summing to greater than 1.0 with GEOMETRY_INVALID', () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      targets: [
        { price: 110_000, fraction: 0.7 },
        { price: 112_000, fraction: 0.5 },
      ], // Sum = 1.2
    };

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('GEOMETRY_INVALID');
  });

  it('rejects inverted entryZone where lower > upper with GEOMETRY_INVALID', () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      entryZone: { lower: 109_000, upper: 108_000 },
      stopLoss: 107_000,
    };

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('GEOMETRY_INVALID');
  });

  it('rejects unsupported evidence refs not found in snapshot with EVIDENCE_REF_INVALID', () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      evidenceFor: [
        {
          snapshotField: 'structure.phantomPivots.nonExistent',
          source: 'BINANCE_FUTURES',
          sourceTimestamp: observedAt,
          calculationVersion: 1,
        },
      ],
    };

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('EVIDENCE_REF_INVALID');
  });

  it('rejects evidence refs with future timestamp or calculationVersion mismatch with EVIDENCE_REF_INVALID', () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      evidenceFor: [
        {
          snapshotField: 'structure',
          source: 'BINANCE_FUTURES',
          sourceTimestamp: '2026-09-09T13:00:00.000Z', // Future relative to cutoff
          calculationVersion: 1,
        },
      ],
    };

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('EVIDENCE_REF_INVALID');
  });

  it('rejects expired thesis where expiresAt <= snapshot.sourceDataCutoff with THESIS_STALE', () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      expiresAt: '2026-09-09T11:30:00.000Z', // Before cutoff (12:00)
    };

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('THESIS_STALE');
  });

  it('rejects expected net R below policy threshold with NET_R_TOO_LOW', () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      expectedNetR: 0.5, // Below default 1.0 policy
    };

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('NET_R_TOO_LOW');
  });

  it('rejects missing expected net R on actionable thesis with NET_R_TOO_LOW', () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      expectedNetR: null,
    };

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('NET_R_TOO_LOW');
  });

  it('rejects LONG thesis when current price exceeds maximumChaseDistanceAtr with ENTRY_TOO_LATE', () => {
    const snapshot = createBaseSnapshot();
    // ATR = 200, entryZone.upper = 108_500, maxChaseDistanceAtr = 0.6 => max allowed price = 108_500 + 120 = 108_620
    // Set current price to 108_700 (chase = 200 = 1.0 ATR > 0.6 ATR)
    if (snapshot.execution.coverage === 'AVAILABLE') {
      snapshot.execution.currentPrice = 108_700;
    }
    const thesis = createValidLongThesis();

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('ENTRY_TOO_LATE');
  });

  it('rejects SHORT thesis when current price falls beyond maximumChaseDistanceAtr with ENTRY_TOO_LATE', () => {
    const snapshot = createBaseSnapshot();
    // ATR = 200, entryZone.lower = 111_000, maxChaseDistanceAtr = 0.6 => min allowed price = 111_000 - 120 = 110_880
    // Set current price to 110_700 (chase = 300 = 1.5 ATR > 0.6 ATR)
    if (snapshot.execution.coverage === 'AVAILABLE') {
      snapshot.execution.currentPrice = 110_700;
    }
    const thesis: TradeThesis = {
      ...createValidLongThesis(),
      direction: 'SHORT',
      entryZone: { lower: 111_000, upper: 111_500 },
      stopLoss: 112_000,
      invalidation: { price: 112_100, reason: 'Breakout above' },
      targets: [{ price: 108_000, fraction: 1.0 }],
    };

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('ENTRY_TOO_LATE');
  });

  it('rejects thesis with state TOO_LATE with ENTRY_TOO_LATE', () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      state: 'TOO_LATE' as const,
    };

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('ENTRY_TOO_LATE');
  });

  it('aggregates multiple violation reason codes without duplicates', () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      invalidation: null, // PROTECTION_REQUIRED
      stopLoss: 109_000, // GEOMETRY_INVALID (>= entryZone.lower 108_000)
      expectedNetR: 0.2, // NET_R_TOO_LOW
      expiresAt: '2026-09-09T11:00:00.000Z', // THESIS_STALE
    };

    const result = validateTradeThesis(thesis, snapshot);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('PROTECTION_REQUIRED');
    expect(result.reasonCodes).toContain('GEOMETRY_INVALID');
    expect(result.reasonCodes).toContain('NET_R_TOO_LOW');
    expect(result.reasonCodes).toContain('THESIS_STALE');
    expect(new Set(result.reasonCodes).size).toBe(result.reasonCodes.length);
  });

  it('validates a valid WAIT thesis with null trade geometry', () => {
    const snapshot = createBaseSnapshot();
    const waitThesis: TradeThesis = {
      thesisVersion: 1,
      decisionSource: 'RULES',
      state: 'WAIT',
      direction: 'WAIT',
      regime: 'RANGING_CONSOLIDATION',
      transitionProbability: 0.5,
      setup: 'NO_TRADE',
      entryZone: null,
      trigger: [],
      invalidation: null,
      stopLoss: null,
      targets: [],
      expectedNetR: null,
      maximumChaseDistanceAtr: 0.6,
      confidence: 50,
      evidenceFor: [],
      evidenceAgainst: [],
      missingEvidence: ['volatility.expansionState'],
      expiresAt: '2026-09-09T12:30:00.000Z',
    };

    const result = validateTradeThesis(waitThesis, snapshot);

    expect(result.valid).toBe(true);
    expect(result.status).toBe('VALID');
    expect(result.reasonCodes).toEqual([]);
  });
});
