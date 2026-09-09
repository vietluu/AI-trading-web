export interface EvidenceGateResult {
  severity: 'BLOCK' | 'REDUCE_SIZE' | 'APPROVE';
  sizeFactor?: number;
  reasons: string[];
}

export interface EvidenceGateInput {
  coreDataStale?: boolean;
  unsafeGeometry?: boolean;
  missingProtection?: boolean;
  costTooHigh?: boolean;
  hardAccountLimit?: boolean;
  negativeExactCohort?: boolean;
  newCohort?: boolean;
  assumptionMismatch?: boolean;
  mode: 'SHADOW' | 'DEMO' | 'LIVE';
}

export function evaluateEvidenceGate(input: EvidenceGateInput): EvidenceGateResult {
  const reasons: string[] = [];
  let severity: 'BLOCK' | 'REDUCE_SIZE' | 'APPROVE' = 'APPROVE';
  let targetFactor = 1.0;

  if (input.coreDataStale) {
    severity = 'BLOCK';
    reasons.push('STALE_CORE_DATA');
  }

  if (input.unsafeGeometry) {
    severity = 'BLOCK';
    reasons.push('UNSAFE_GEOMETRY');
  }

  if (input.missingProtection) {
    severity = 'BLOCK';
    reasons.push('MISSING_PROTECTION');
  }

  if (input.costTooHigh) {
    severity = 'BLOCK';
    reasons.push('COST_TOO_HIGH');
  }

  if (input.hardAccountLimit) {
    severity = 'BLOCK';
    reasons.push('HARD_ACCOUNT_LIMIT');
  }

  if (input.negativeExactCohort) {
    severity = 'BLOCK';
    reasons.push('NEGATIVE_EXACT_COHORT');
  }

  if (input.assumptionMismatch && input.mode === 'LIVE') {
    severity = 'BLOCK';
    reasons.push('ASSUMPTION_MISMATCH_LIVE');
  }

  if (severity === 'BLOCK') {
    return { severity: 'BLOCK', reasons };
  }

  if (input.assumptionMismatch && (input.mode === 'SHADOW' || input.mode === 'DEMO')) {
    severity = 'REDUCE_SIZE';
    reasons.push('ASSUMPTION_MISMATCH_PROBE');
    targetFactor = Math.min(targetFactor, 0.1);
  }

  if (input.newCohort) {
    severity = 'REDUCE_SIZE';
    reasons.push('NEW_COHORT');
    targetFactor = Math.min(targetFactor, 0.25);
  }

  if (severity === 'REDUCE_SIZE') {
    return {
      severity: 'REDUCE_SIZE',
      sizeFactor: Math.max(0.05, Math.min(1.0, targetFactor)),
      reasons,
    };
  }

  reasons.push('VALID_EXACT_EVIDENCE');
  return { severity: 'APPROVE', reasons };
}
