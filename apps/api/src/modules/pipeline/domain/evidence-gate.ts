export interface EvidenceGateResult {
  severity: 'BLOCK' | 'REDUCE_SIZE' | 'APPROVE';
  riskTier?: 'NORMAL' | 'PROBE' | 'BLOCKED';
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

export interface EvidenceGateOptions {
  minSizeFactor?: number;
  maxSizeFactor?: number;
}

export function evaluateEvidenceGate(input: EvidenceGateInput, options?: EvidenceGateOptions): EvidenceGateResult {
  const reasons: string[] = [];
  let factor = 1.0;

  if (input.coreDataStale) reasons.push('STALE_CORE_DATA');
  if (input.unsafeGeometry) reasons.push('UNSAFE_GEOMETRY');
  if (input.missingProtection) reasons.push('MISSING_PROTECTION');
  if (input.costTooHigh) reasons.push('COST_TOO_HIGH');
  if (input.hardAccountLimit) reasons.push('HARD_ACCOUNT_LIMIT');
  if (input.negativeExactCohort) reasons.push('NEGATIVE_EXACT_COHORT');
  
  if (input.assumptionMismatch && input.mode === 'LIVE') reasons.push('ASSUMPTION_MISMATCH_LIVE');
  if (input.newCohort && input.mode === 'LIVE') reasons.push('NEW_COHORT_LIVE');

  if (reasons.length > 0) {
    return { severity: 'BLOCK', riskTier: 'BLOCKED', reasons };
  }

  let severity: 'BLOCK' | 'REDUCE_SIZE' | 'APPROVE' = 'APPROVE';

  if (input.assumptionMismatch) {
    severity = 'REDUCE_SIZE';
    reasons.push('ASSUMPTION_MISMATCH_PROBE');
    factor *= 0.1;
  }

  if (input.newCohort) {
    severity = 'REDUCE_SIZE';
    reasons.push('NEW_COHORT');
    factor *= 0.25;
  }

  if (severity === 'REDUCE_SIZE') {
    const minSize = options?.minSizeFactor ?? 0.05;
    const maxSize = options?.maxSizeFactor ?? 1.0;
    return {
      severity: 'REDUCE_SIZE',
      riskTier: 'PROBE',
      sizeFactor: Math.max(minSize, Math.min(maxSize, factor)),
      reasons,
    };
  }

  reasons.push('VALID_EXACT_EVIDENCE');
  return { severity: 'APPROVE', riskTier: 'NORMAL', reasons };
}


/** Compose independent reductions once. A zero factor or any BLOCK stays blocked. */
export function composeEvidenceSize(gates: EvidenceGateResult[], options: EvidenceGateOptions = {}): EvidenceGateResult {
  const reasons = [...new Set(gates.flatMap((gate) => gate.reasons))];
  if (gates.some((gate) => gate.severity === 'BLOCK' || gate.sizeFactor === 0)) {
    return { severity: 'BLOCK', riskTier: 'BLOCKED', sizeFactor: 0, reasons };
  }
  const raw = gates.reduce((factor, gate) => factor * (gate.sizeFactor ?? 1), 1);
  const min = options.minSizeFactor ?? 0.05;
  const max = options.maxSizeFactor ?? 1;
  const sizeFactor = Math.min(max, Math.max(min, raw));
  const severity = sizeFactor < 1 ? 'REDUCE_SIZE' : 'APPROVE';
  const riskTier = severity === 'REDUCE_SIZE' ? 'PROBE' : 'NORMAL';
  return { severity, riskTier, sizeFactor, reasons };
}
