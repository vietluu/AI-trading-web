import { describe, it, expect } from 'vitest';
import { evaluateEvidenceGate } from '../../src/modules/pipeline/domain/evidence-gate';

describe('EvidenceGate', () => {
  it('blocks stale core data', () => {
    const result = evaluateEvidenceGate({ coreDataStale: true, mode: 'LIVE' });
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('STALE_CORE_DATA');
  });

  it('blocks unsafe geometry', () => {
    const result = evaluateEvidenceGate({ unsafeGeometry: true, mode: 'LIVE' });
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('UNSAFE_GEOMETRY');
  });

  it('blocks missing protection', () => {
    const result = evaluateEvidenceGate({ missingProtection: true, mode: 'LIVE' });
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('MISSING_PROTECTION');
  });

  it('blocks cost too high', () => {
    const result = evaluateEvidenceGate({ costTooHigh: true, mode: 'LIVE' });
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('COST_TOO_HIGH');
  });

  it('blocks hard account limit', () => {
    const result = evaluateEvidenceGate({ hardAccountLimit: true, mode: 'LIVE' });
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('HARD_ACCOUNT_LIMIT');
  });

  it('blocks negative exact cohort', () => {
    const result = evaluateEvidenceGate({ negativeExactCohort: true, mode: 'LIVE' });
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('NEGATIVE_EXACT_COHORT');
  });

  it('blocks assumption mismatch in LIVE', () => {
    const result = evaluateEvidenceGate({ assumptionMismatch: true, mode: 'LIVE' });
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('ASSUMPTION_MISMATCH_LIVE');
  });

  it('blocks when new cohort in LIVE mode', () => {
    const result = evaluateEvidenceGate({ newCohort: true, mode: 'LIVE' });
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('NEW_COHORT_LIVE');
  });

  it('reduces size for new cohort in DEMO/SHADOW', () => {
    const result = evaluateEvidenceGate({ newCohort: true, mode: 'DEMO' });
    expect(result.severity).toBe('REDUCE_SIZE');
    expect(result.reasons).toContain('NEW_COHORT');
    expect(result.sizeFactor).toBe(0.25);
  });

  it('reduces size for isolated assumption mismatch in DEMO', () => {
    const result = evaluateEvidenceGate({ assumptionMismatch: true, mode: 'DEMO' });
    expect(result.severity).toBe('REDUCE_SIZE');
    expect(result.reasons).toContain('ASSUMPTION_MISMATCH_PROBE');
    expect(result.sizeFactor).toBe(0.1);
  });

  it('reduces size for assumption mismatch in SHADOW', () => {
    const result = evaluateEvidenceGate({ assumptionMismatch: true, mode: 'SHADOW' });
    expect(result.severity).toBe('REDUCE_SIZE');
    expect(result.reasons).toContain('ASSUMPTION_MISMATCH_PROBE');
    expect(result.sizeFactor).toBe(0.1);
  });

  it('composes reduction factors', () => {
    const result = evaluateEvidenceGate({ newCohort: true, assumptionMismatch: true, mode: 'DEMO' });
    expect(result.severity).toBe('REDUCE_SIZE');
    expect(result.reasons).toContain('ASSUMPTION_MISMATCH_PROBE');
    expect(result.reasons).toContain('NEW_COHORT');
    expect(result.sizeFactor).toBe(0.05); // 0.1 * 0.25 = 0.025, clamped to min 0.05
  });

  it('overrides REDUCE_SIZE with BLOCK when both exist', () => {
    const result = evaluateEvidenceGate({ newCohort: true, coreDataStale: true, mode: 'DEMO' });
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('STALE_CORE_DATA');
  });

  it('approves valid exact evidence', () => {
    const result = evaluateEvidenceGate({ mode: 'LIVE' });
    expect(result.severity).toBe('APPROVE');
    expect(result.reasons).toContain('VALID_EXACT_EVIDENCE');
  });
});

it('never downgrades reliable negative evidence because another gate says new cohort', () => {
  expect(evaluateEvidenceGate({ negativeExactCohort: true, newCohort: true, mode: 'DEMO' }).severity).toBe('BLOCK');
});
