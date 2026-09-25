import { describe, expect, it } from 'vitest';

import { resolveCalibrationAuthority } from '../../src/modules/agents/domain/calibration-authority';

const strongDecision = {
  decision: 'LONG' as const,
  confidence: 85,
  directionalAgreement: 90,
  opportunityScore: 82,
};

describe('resolveCalibrationAuthority', () => {
  it('lets only exact non-fallback calibration supply hard-gate probability', () => {
    expect(resolveCalibrationAuthority({
      status: 'CALIBRATED',
      scope: 'EXACT',
      fallbackUsed: false,
      hardGateEligible: true,
      empiricalProbability: 0.31,
    }, strongDecision)).toEqual({
      authority: 'EXACT_BLOCK',
      empiricalProbability: 0.31,
      preserveSynthesizedEconomics: false,
      forceProbe: false,
    });
  });

  it('keeps a negative global fallback as telemetry and bounds a strong setup to probe', () => {
    expect(resolveCalibrationAuthority({
      status: 'CALIBRATED',
      scope: 'USER_GLOBAL',
      fallbackUsed: true,
      hardGateEligible: false,
      empiricalProbability: 0.3125,
    }, strongDecision)).toEqual({
      authority: 'PROBE_TELEMETRY',
      empiricalProbability: undefined,
      preserveSynthesizedEconomics: true,
      forceProbe: true,
    });
  });

  it('does not turn a weak fallback candidate into an executable probe', () => {
    expect(resolveCalibrationAuthority({
      status: 'CALIBRATED',
      scope: 'STRATEGY_CONTEXT',
      fallbackUsed: true,
      hardGateEligible: false,
      empiricalProbability: 0.52,
    }, { ...strongDecision, confidence: 74 })).toEqual({
      authority: 'NEUTRAL',
      empiricalProbability: undefined,
      preserveSynthesizedEconomics: false,
      forceProbe: false,
    });
  });

  it('preserves synthesized economics with probe sizing for setups with opportunity score 73', () => {
    expect(resolveCalibrationAuthority({
      status: 'CALIBRATED',
      scope: 'STRATEGY_CONTEXT',
      fallbackUsed: true,
      hardGateEligible: false,
      empiricalProbability: 0.2874,
    }, {
      decision: 'SHORT' as const,
      confidence: 82,
      directionalAgreement: 100,
      opportunityScore: 73,
    })).toEqual({
      authority: 'PROBE_TELEMETRY',
      empiricalProbability: undefined,
      preserveSynthesizedEconomics: true,
      forceProbe: true,
    });
  });

  it('bounds uncalibrated cold-start setup to probe while preserving economics', () => {
    expect(resolveCalibrationAuthority(undefined, {
      decision: 'LONG' as const,
      confidence: 85,
      directionalAgreement: 100,
      opportunityScore: 78,
    })).toEqual({
      authority: 'NEUTRAL',
      empiricalProbability: undefined,
      preserveSynthesizedEconomics: true,
      forceProbe: false,
    });
  });
});

