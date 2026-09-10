import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { TradeThesis } from '@platform/shared';
import { validateTradeThesis, applyThesisReview } from '../../src/modules/agents/domain/trade-thesis-validator';

import { cutoff, observedAt, createBaseSnapshot, createValidLongThesis } from '../helpers/thesis-fixture';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(cutoff)); });
afterEach(() => vi.useRealTimers());

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

describe('applyThesisReview', () => {
  it('maps CANCEL to WAIT state and clears geometry', () => {
    const thesis = createValidLongThesis();
    const result = applyThesisReview(thesis, {
      action: 'CANCEL',
      reasonCodes: ['NO_VOLUME'],
      evidenceRefs: [],
      rationale: 'Volume drying up'
    });

    expect(result.direction).toBe('WAIT');
    expect(result.state).toBe('WAIT');
    expect(result.setup).toBe('NO_TRADE');
    expect(result.entryZone).toBeNull();
    expect(result.stopLoss).toBeNull();
    expect(result.targets).toEqual([]);
    expect(result.expectedNetR).toBeNull();
    expect(result.missingEvidence).toContain('NO_VOLUME');
  });

  it('maps REQUIRE_TRIGGER to WATCHING state', () => {
    const thesis = createValidLongThesis();
    const result = applyThesisReview(thesis, {
      action: 'REQUIRE_TRIGGER',
      reasonCodes: ['NEEDS_CONFIRMATION'],
      evidenceRefs: [],
      rationale: 'Wait for 15m close'
    });

    expect(result.direction).toBe('LONG'); // direction remains
    expect(result.state).toBe('WATCHING');
    expect(result.missingEvidence).toContain('NEEDS_CONFIRMATION');
    expect(result.entryZone).not.toBeNull();
  });

  it('preserves expectedNetR for REDUCE_SIZE', () => {
    const thesis = createValidLongThesis();
    thesis.expectedNetR = 2.0;
    const result = applyThesisReview(thesis, {
      action: 'REDUCE_SIZE',
      sizeFactor: 0.5,
      reasonCodes: ['HIGH_RISK'],
      evidenceRefs: [],
      rationale: 'Reduce risk due to news'
    });

    expect(result.direction).toBe('LONG');
    expect(result.expectedNetR).toBe(2.0);
    expect(result.missingEvidence).toContain('HIGH_RISK');
  });

  it('preserves fields on APPROVE', () => {
    const thesis = createValidLongThesis();
    const originalNetR = thesis.expectedNetR;
    const result = applyThesisReview(thesis, {
      action: 'APPROVE',
      reasonCodes: [],
      evidenceRefs: [],
      rationale: 'Looks good'
    });

    expect(result.direction).toBe('LONG');
    expect(result.state).toBe('PROBE_READY');
    expect(result.expectedNetR).toBe(originalNetR);
  });
});


describe('review safety regressions', () => {
  it.each(['structure', 'volatility', 'momentum', 'participation', 'execution'] as const)('rejects stale %s core evidence', (field) => {
    const snapshot = createBaseSnapshot();
    snapshot[field].freshness = 'STALE';
    expect(validateTradeThesis(createValidLongThesis(), snapshot, { now: cutoff }).valid).toBe(false);
  });
  it('rejects an ineligible snapshot', () => {
    const snapshot = createBaseSnapshot();
    snapshot.eligibility.status = 'INELIGIBLE';
    expect(validateTradeThesis(createValidLongThesis(), snapshot, { now: cutoff }).valid).toBe(false);
  });
  it.each([
    { trigger: [] }, { evidenceFor: [] },
    { invalidation: { price: 109000, reason: 'Wrong side' } },
    { targets: [{ price: 108250, fraction: 1 }] },
    { targets: [{ price: 112000, fraction: 0 }] },
    { targets: [{ price: 108600, fraction: 1 }], expectedNetR: 100 },
  ])('rejects incomplete or economically invalid thesis %j', (change) => {
    expect(validateTradeThesis({ ...createValidLongThesis(), ...change }, createBaseSnapshot(), { now: cutoff }).valid).toBe(false);
  });
  it('does not change net R when critic reduces size', () => {
    const thesis = createValidLongThesis();
    expect(applyThesisReview(thesis, { action: 'REDUCE_SIZE', sizeFactor: 0.25, reasonCodes: [], evidenceRefs: [], rationale: 'uncertain' }).expectedNetR).toBe(thesis.expectedNetR);
  });
});
