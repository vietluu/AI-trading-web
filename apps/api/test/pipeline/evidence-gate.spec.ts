import { describe, it, expect } from 'vitest';
import { evaluateEvidenceGate } from '../../src/modules/pipeline/domain/evidence-gate';

describe('EvidenceGate', () => {
  it('blocks stale core data', () => {
    const result = evaluateEvidenceGate({
      coreDataStale: true,
      unsafeGeometry: false,
      negativeExactCohort: false,
      newCohort: false,
      assumptionMismatch: false,
      mode: 'LIVE',
    });
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('STALE_CORE_DATA');
  });

  it('blocks unsafe geometry', () => {
    const result = evaluateEvidenceGate({
      coreDataStale: false,
      unsafeGeometry: true,
      negativeExactCohort: false,
      newCohort: false,
      assumptionMismatch: false,
      mode: 'LIVE',
    });
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('UNSAFE_GEOMETRY');
  });

  it('blocks negative exact cohort', () => {
    const result = evaluateEvidenceGate({
      coreDataStale: false,
      unsafeGeometry: false,
      negativeExactCohort: true,
      newCohort: false,
      assumptionMismatch: false,
      mode: 'LIVE',
    });
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('NEGATIVE_EXACT_COHORT');
  });

  it('blocks assumption mismatch in LIVE', () => {
    const result = evaluateEvidenceGate({
      coreDataStale: false,
      unsafeGeometry: false,
      negativeExactCohort: false,
      newCohort: false,
      assumptionMismatch: true,
      mode: 'LIVE',
    });
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('ASSUMPTION_MISMATCH_LIVE');
  });

  it('reduces size for new cohort in DEMO/SHADOW', () => {
    const result = evaluateEvidenceGate({
      coreDataStale: false,
      unsafeGeometry: false,
      negativeExactCohort: false,
      newCohort: true,
      assumptionMismatch: false,
      mode: 'DEMO',
    });
    expect(result.severity).toBe('REDUCE_SIZE');
    expect(result.reasons).toContain('NEW_COHORT');
    expect(result.sizeFactor).toBe(0.25);
  });

  it('reduces size for assumption mismatch in SHADOW', () => {
    const result = evaluateEvidenceGate({
      coreDataStale: false,
      unsafeGeometry: false,
      negativeExactCohort: false,
      newCohort: false,
      assumptionMismatch: true,
      mode: 'SHADOW',
    });
    expect(result.severity).toBe('REDUCE_SIZE');
    expect(result.reasons).toContain('ASSUMPTION_MISMATCH_PROBE');
    expect(result.sizeFactor).toBe(0.1);
  });

  it('composes reduction factors', () => {
    const result = evaluateEvidenceGate({
      coreDataStale: false,
      unsafeGeometry: false,
      negativeExactCohort: false,
      newCohort: true,
      assumptionMismatch: true,
      mode: 'DEMO',
    });
    expect(result.severity).toBe('REDUCE_SIZE');
    expect(result.reasons).toContain('ASSUMPTION_MISMATCH_PROBE');
    expect(result.reasons).toContain('NEW_COHORT');
    expect(result.sizeFactor).toBe(0.1);
  });

  it('approves valid exact evidence', () => {
    const result = evaluateEvidenceGate({
      coreDataStale: false,
      unsafeGeometry: false,
      negativeExactCohort: false,
      newCohort: false,
      assumptionMismatch: false,
      mode: 'LIVE',
    });
    expect(result.severity).toBe('APPROVE');
    expect(result.reasons).toContain('VALID_EXACT_EVIDENCE');
  });
});
