import { describe, expect, it } from 'vitest';
import {
  buildReliabilityCurve,
  calibrateConfidence,
  calibrateConfidenceWithFallback,
} from '../../src/modules/reflection/domain/confidence-calibration';

describe('confidence calibration', () => {
  it('reports reliability buckets and Brier score from realized outcomes', () => {
    const records = Array.from({ length: 60 }, (_, index) => ({
      confidence: 75,
      outcome: index < 42 ? 'CORRECT' as const : 'WRONG' as const,
    }));
    const curve = buildReliabilityCurve(records);
    const calibration = calibrateConfidence(75, records);

    expect(curve.sampleSize).toBe(60);
    expect(curve.brierScore).not.toBeNull();
    expect(calibration.status).toBe('CALIBRATED');
    expect(calibration.empiricalProbability).toBeCloseTo(44 / 64);
  });

  it('does not present a probability when history is insufficient', () => {
    const calibration = calibrateConfidence(80, [
      { confidence: 80, outcome: 'CORRECT' },
    ]);
    expect(calibration.status).toBe('INSUFFICIENT_HISTORY');
    expect(calibration.empiricalProbability).toBeNull();
  });

  it('uses calibrated user history as fallback for a new symbol', () => {
    const global = Array.from({ length: 60 }, (_, index) => ({
      confidence: 75,
      outcome: index < 40 ? 'CORRECT' as const : 'WRONG' as const,
    }));
    const calibration = calibrateConfidenceWithFallback(75, [
      { scope: 'EXACT', records: [] },
      { scope: 'STRATEGY_CONTEXT', records: [] },
      { scope: 'STRATEGY_TIMEFRAME', records: [] },
      { scope: 'USER_GLOBAL', records: global },
    ]);

    expect(calibration.status).toBe('CALIBRATED');
    expect(calibration.scope).toBe('USER_GLOBAL');
    expect(calibration.fallbackUsed).toBe(true);
    expect(calibration.hardGateEligible).toBe(false);
  });

  it('blends a mature exact bucket with its calibrated parent before the exact scope reaches 50 samples', () => {
    const exact = Array.from({ length: 38 }, (_, index) => ({
      confidence: 75,
      outcome: index < 23 ? 'CORRECT' as const : 'WRONG' as const,
    }));
    const parent = Array.from({ length: 80 }, (_, index) => ({
      confidence: 75,
      outcome: index < 36 ? 'CORRECT' as const : 'WRONG' as const,
    }));
    const calibration = calibrateConfidenceWithFallback(75, [
      { scope: 'EXACT', records: exact },
      { scope: 'STRATEGY_CONTEXT', records: parent },
    ]);
    expect(calibration.status).toBe('CALIBRATED');
    expect(calibration.scope).toBe('BLENDED');
    expect(calibration.hardGateEligible).toBe(true);
    expect(calibration.exactProbability).toBeGreaterThan(calibration.fallbackProbability ?? 0);
    expect(calibration.empiricalProbability).toBeGreaterThan(0.5);
  });

  it('marks a completely new account as cold start without inventing probability', () => {
    const calibration = calibrateConfidenceWithFallback(75, [
      { scope: 'EXACT', records: [] },
      { scope: 'USER_GLOBAL', records: [] },
    ]);

    expect(calibration.status).toBe('INSUFFICIENT_HISTORY');
    expect(calibration.scope).toBe('NONE');
    expect(calibration.empiricalProbability).toBeNull();
  });
});
