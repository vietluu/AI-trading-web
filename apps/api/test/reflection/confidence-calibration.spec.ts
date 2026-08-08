import { describe, expect, it } from 'vitest';
import {
  buildReliabilityCurve,
  calibrateConfidence,
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
});
