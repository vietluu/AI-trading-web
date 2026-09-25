export type CalibrationAuthorityInput = {
  status?: 'CALIBRATED' | 'INSUFFICIENT_HISTORY';
  scope?: 'EXACT' | 'BLENDED' | 'STRATEGY_CONTEXT' | 'STRATEGY_TIMEFRAME' | 'USER_GLOBAL' | 'NONE';
  fallbackUsed?: boolean;
  hardGateEligible?: boolean;
  empiricalProbability?: number | null;
};

export type CalibrationDecisionFacts = {
  decision: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
  directionalAgreement?: number;
  opportunityScore: number;
};

export type CalibrationAuthority = {
  authority: 'EXACT_BLOCK' | 'PROBE_TELEMETRY' | 'NEUTRAL';
  empiricalProbability: number | undefined;
  preserveSynthesizedEconomics: boolean;
  forceProbe: boolean;
};

export function resolveCalibrationAuthority(
  calibration: CalibrationAuthorityInput | undefined,
  decision: CalibrationDecisionFacts,
): CalibrationAuthority {
  const exactProbability = calibration?.status === 'CALIBRATED' &&
    calibration.scope === 'EXACT' &&
    calibration.fallbackUsed !== true &&
    calibration.hardGateEligible === true &&
    Number.isFinite(calibration.empiricalProbability)
      ? calibration.empiricalProbability ?? undefined
      : undefined;

  if (exactProbability !== undefined) {
    return {
      authority: 'EXACT_BLOCK',
      empiricalProbability: exactProbability,
      preserveSynthesizedEconomics: false,
      forceProbe: false,
    };
  }

  const fallbackTelemetry = calibration?.status === 'CALIBRATED' &&
    (calibration.fallbackUsed === true || calibration.scope !== 'EXACT');
  const strongDirectionalSetup = decision.decision !== 'WAIT' &&
    decision.confidence >= 80 &&
    (decision.directionalAgreement ?? 0) >= 80 &&
    decision.opportunityScore >= 70;

  if (fallbackTelemetry && strongDirectionalSetup) {
    return {
      authority: 'PROBE_TELEMETRY',
      empiricalProbability: undefined,
      preserveSynthesizedEconomics: true,
      forceProbe: true,
    };
  }

  const isColdStart = !calibration ||
    calibration.status === 'INSUFFICIENT_HISTORY' ||
    calibration.hardGateEligible === false;

  return {
    authority: 'NEUTRAL',
    empiricalProbability: undefined,
    preserveSynthesizedEconomics: isColdStart && strongDirectionalSetup,
    forceProbe: false,
  };
}
