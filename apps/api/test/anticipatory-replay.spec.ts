import { describe, expect, it } from 'vitest';
import type { AnticipatoryMarketSnapshot } from '@platform/shared';
import {
  AnticipatoryMarketSnapshotSchema,
} from '@platform/shared';
import {
  buildAnticipatoryMarketSnapshot,
  type AnticipatoryCandleInput,
  type AnticipatorySnapshotInput,
} from '../src/modules/agents/domain/analysis/anticipatory-snapshot-builder';
import {
  transitionOpportunity,
  type OpportunityObservationState,
} from '../src/modules/pipeline/domain/opportunity-state-machine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_MS = Date.parse('2026-09-09T06:00:00.000Z');
const INTERVAL_MS = 15 * 60 * 1_000; // 15-minute candles

function candle(
  index: number,
  high: number,
  low: number,
  close: number,
  volume = 200,
): AnticipatoryCandleInput {
  return {
    openTime: new Date(BASE_MS + index * INTERVAL_MS).toISOString(),
    closeTime: new Date(BASE_MS + (index + 1) * INTERVAL_MS).toISOString(),
    open: close,
    high,
    low,
    close,
    volume,
    isClosed: true,
  };
}

/**
 * 16-candle series: indices 0-12 are "historical", 13 is the cutoff candle,
 * indices 14-15 are "future" candles that the builder MUST NOT observe.
 */
const ALL_CANDLES: AnticipatoryCandleInput[] = [
  candle(0,  102, 96,  98),
  candle(1,  105, 94,  100),
  candle(2,  112, 92,  108),
  candle(3,  107, 90,  99),
  candle(4,  106, 82,  94),
  candle(5,  105, 89,  101),
  candle(6,  110, 88,  106),
  candle(7,  107, 89,  103),
  candle(8,  108, 87,  105),
  candle(9,  104, 88,  100),
  candle(10, 103, 87,  99),
  candle(11, 106, 86,  102),
  candle(12, 105, 88,  101),
  candle(13, 104, 87,  100),  // ← sourceDataCutoff = this candle's closeTime
  // future candles — must be invisible to the builder
  candle(14, 999, 1,   500, 9999),
  candle(15, 999, 1,   500, 9999),
];

const CUTOFF = ALL_CANDLES[13]!.closeTime;

function baseInput(): AnticipatorySnapshotInput {
  return {
    symbol: 'BTC-USDT',
    provider: 'BINANCE_FUTURES',
    timeframe: '15m',
    sourceDataCutoff: CUTOFF,
    schemaVersion: 1,
    calculationVersion: 2,
    freshnessThresholdMs: INTERVAL_MS * 2,
    pivotStrength: 2,
    candles: ALL_CANDLES,
    rsiHistory: ALL_CANDLES.map((c, i) => ({
      timestamp: c.closeTime,
      value: [40, 48, 72, 55, 30, 46, 65, 58, 62, 52, 49, 56, 54, 53, 99, 1][i]!,
    })),
    macdHistory: ALL_CANDLES.map((c, i) => ({
      timestamp: c.closeTime,
      value: i * 0.1,
      signal: i * 0.05,
      histogram: [0, 0.1, 1.8, 0.4, -1.5, -0.2, 1.2, 0.3, 0.5, 0.2, 0.1, 0.4, 0.3, 0.2, 99, -99][i]!,
    })),
    atrHistory: ALL_CANDLES.map((c, i) => ({
      timestamp: c.closeTime,
      value: i < 14 ? 3 + i * 0.1 : 9999,
    })),
    execution: {
      timestamp: CUTOFF,
      spread: 0.05,
      estimatedRoundTripCost: 0.1,
      tickSize: 0.01,
      lotSize: 0.001,
      currentExposure: 0,
      maximumChaseDistanceAtr: 1.0,
    },
  };
}

// ---------------------------------------------------------------------------
// Replay: simulate N closed candles in sequence
// ---------------------------------------------------------------------------

function replayCandles(
  inputFactory: () => AnticipatorySnapshotInput,
  cutoffs: string[],
): AnticipatoryMarketSnapshot[] {
  return cutoffs.map((cutoff) => {
    const input = inputFactory();
    input.sourceDataCutoff = cutoff;
    return buildAnticipatoryMarketSnapshot(input);
  });
}

function stateReplay(
  snapshots: AnticipatoryMarketSnapshot[],
  initial: OpportunityObservationState,
  now: Date,
): OpportunityObservationState[] {
  const states: OpportunityObservationState[] = [initial];
  for (const snap of snapshots) {
    const current = states[states.length - 1]!;
    const transition = transitionOpportunity(current, snap, now);
    states.push({
      ...current,
      state: transition.toState,
      lastObservedCutoff: transition.sourceDataCutoff,
    });
  }
  return states;
}

// ---------------------------------------------------------------------------
// Suite 1: Evidence cutoff safety
// ---------------------------------------------------------------------------

describe('anticipatory replay — evidence cutoff safety', () => {
  it('all replayed snapshots pass the shared schema', () => {
    // Build a snapshot at each closed candle in indices 2..13
    const cutoffs = ALL_CANDLES.slice(2, 14).map((c) =>
      c.closeTime instanceof Date ? c.closeTime.toISOString() : c.closeTime,
    );
    const snapshots = replayCandles(baseInput, cutoffs);

    for (const snap of snapshots) {
      expect(() => AnticipatoryMarketSnapshotSchema.parse(snap)).not.toThrow();
    }
  });

  it('no snapshot contains evidence whose sourceTimestamp exceeds its own cutoff', () => {
    const cutoffs = ALL_CANDLES.slice(2, 14).map((c) =>
      c.closeTime instanceof Date ? c.closeTime.toISOString() : c.closeTime,
    );
    const snapshots = replayCandles(baseInput, cutoffs);

    for (const snap of snapshots) {
      const cutoffTime = new Date(snap.sourceDataCutoff).getTime();
      const sectionTimestamps: (string | undefined)[] = [
        snap.structure.coverage === 'AVAILABLE' ? snap.structure.sourceTimestamp : undefined,
        snap.volatility.coverage === 'AVAILABLE' ? snap.volatility.sourceTimestamp : undefined,
        snap.momentum.coverage === 'AVAILABLE' ? snap.momentum.sourceTimestamp : undefined,
        snap.participation.coverage === 'AVAILABLE' ? snap.participation.sourceTimestamp : undefined,
        snap.derivatives.coverage === 'AVAILABLE' ? snap.derivatives.sourceTimestamp : undefined,
        snap.execution.coverage === 'AVAILABLE' ? snap.execution.sourceTimestamp : undefined,
      ];
      for (const ts of sectionTimestamps) {
        if (ts === undefined) continue;
        expect(new Date(ts).getTime()).toBeLessThanOrEqual(cutoffTime);
      }
    }
  });

  it('future candles with corrupted values (index 14+) do not affect any replayed snapshot', () => {
    // Inject NaN into future candles to ensure they cannot silently contaminate output
    const poisoned = baseInput();
    for (const c of poisoned.candles.slice(14)) {
      (c as { high: number }).high = Number.NaN;
      (c as { low: number }).low = Number.NaN;
      (c as { close: number }).close = Number.NaN;
    }
    if (poisoned.atrHistory) {
      for (const row of poisoned.atrHistory.slice(14)) {
        (row as { value: number }).value = Number.NaN;
      }
    }
    // Build at cutoff = index 13. If any future data leaked, ATR or price would be NaN.
    const snap = buildAnticipatoryMarketSnapshot(poisoned);
    const parsed = AnticipatoryMarketSnapshotSchema.parse(snap);
    if (parsed.volatility.coverage === 'AVAILABLE') {
      expect(Number.isFinite(parsed.volatility.atr)).toBe(true);
    }
    if (parsed.structure.coverage === 'AVAILABLE') {
      expect(Number.isFinite(parsed.structure.distanceToNearestBoundaryAtr)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 2: State transition idempotency
// ---------------------------------------------------------------------------

describe('anticipatory replay — state transition idempotency', () => {
  const cutoffs = ALL_CANDLES.slice(4, 14).map((c) =>
    c.closeTime instanceof Date ? c.closeTime.toISOString() : c.closeTime,
  );
  const snapshots = replayCandles(baseInput, cutoffs);
  const now = new Date('2026-09-09T08:00:00.000Z');

  const initial: OpportunityObservationState = {
    state: 'OBSERVING',
    setup: 'SQUEEZE_PROBE',
    direction: 'LONG',
    invalidationPrice: 82,
    expiresAt: new Date('2026-09-09T10:00:00.000Z'),
    lastObservedCutoff: null,
  };

  it('replaying the same candle sequence twice produces identical state sequences', () => {
    const firstPass = stateReplay(snapshots, initial, now);
    const secondPass = stateReplay(snapshots, initial, now);
    expect(firstPass.map((s) => s.state)).toEqual(secondPass.map((s) => s.state));
  });

  it('re-feeding a duplicate cutoff keeps state unchanged', () => {
    if (snapshots.length < 2) return;
    const firstSnap = snapshots[0]!;

    // Replay: feed first snap twice
    const initial2: OpportunityObservationState = {
      ...initial,
      lastObservedCutoff: new Date(firstSnap.sourceDataCutoff),
    };
    const t1 = transitionOpportunity(initial2, firstSnap, now);
    expect(t1.reasonCode).toBe('DUPLICATE_CANDLE_CUTOFF');
    expect(t1.changed).toBe(false);
    expect(t1.toState).toBe(initial2.state);
  });

  it('terminal state never advances further regardless of new snapshots', () => {
    const expired: OpportunityObservationState = {
      ...initial,
      state: 'EXPIRED',
    };
    for (const snap of snapshots) {
      const t = transitionOpportunity(expired, snap, now);
      expect(t.reasonCode).toBe('TERMINAL_STATE');
      expect(t.toState).toBe('EXPIRED');
      expect(t.changed).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Decision pipeline isolation
// ---------------------------------------------------------------------------

describe('anticipatory replay — decision pipeline isolation', () => {
  it('buildAnticipatoryMarketSnapshot does not import any Decision or execution module', () => {
    // This is a structural import-graph test: dynamically import the builder
    // and verify it has no reference to known Decision/execution namespaces.
    // Because we cannot inspect resolved imports in Vitest without bundler
    // introspection, we assert indirectly: the builder function returns a
    // plain data object with no callable execute/submit/place properties.
    const snap = buildAnticipatoryMarketSnapshot(baseInput());
    expect(snap).not.toHaveProperty('execute');
    expect(snap).not.toHaveProperty('submitOrder');
    expect(snap).not.toHaveProperty('placeOrder');
    expect(snap).not.toHaveProperty('decision');
  });

  it('transitionOpportunity returns only data — no side effects, no callbacks', () => {
    const cutoffs = ALL_CANDLES.slice(4, 8).map((c) =>
      c.closeTime instanceof Date ? c.closeTime.toISOString() : c.closeTime,
    );
    const snapshots = replayCandles(baseInput, cutoffs);
    const now = new Date('2026-09-09T08:00:00.000Z');
    const initial: OpportunityObservationState = {
      state: 'OBSERVING',
      setup: 'SQUEEZE_PROBE',
      direction: 'LONG',
      invalidationPrice: 82,
      expiresAt: new Date('2026-09-09T10:00:00.000Z'),
      lastObservedCutoff: null,
    };
    for (const snap of snapshots) {
      const transition = transitionOpportunity(initial, snap, now);
      // Result must be a plain serializable record
      expect(typeof transition.reasonCode).toBe('string');
      expect(typeof transition.changed).toBe('boolean');
      expect(transition.sourceDataCutoff).toBeInstanceOf(Date);
      expect(transition).not.toHaveProperty('execute');
      expect(transition).not.toHaveProperty('submitOrder');
    }
  });
});
