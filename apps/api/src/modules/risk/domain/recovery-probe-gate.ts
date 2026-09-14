export interface RecoveryProbeGateInput {
  enabled: boolean;
  maxSizeFactor?: number;
  maxAccountPositions?: number;
  cooldownMs?: number;
  connection: {
    provider: string;
    environment: string;
    isVerified: boolean;
  };
  evidence: {
    status: string;
    cohortStatus?: string;
    sampleCount?: number;
    freshness: string;
    expectedNetR: number;
    calibrationQuality: string;
  };
  positionContext: {
    activeProbesOnSymbol: number;
    totalAccountPositions: number;
    lastProbeCompletedAt?: Date | string | null;
  };
  chaseDistanceAtr?: number;
  maxChaseDistanceAtr?: number;
  riskApproved?: boolean;
}

export interface RecoveryProbeGateResult {
  approved: boolean;
  reason?: string;
  sizeFactor?: number;
}

export function evaluateRecoveryProbe(input: RecoveryProbeGateInput): RecoveryProbeGateResult {
  if (!input.enabled) {
    return { approved: false, reason: 'RECOVERY_DEMO_PROBE_DISABLED' };
  }

  const { connection, evidence, positionContext } = input;

  if (
    connection.environment !== 'DEMO' ||
    connection.provider !== 'OKX_FUTURES' ||
    !connection.isVerified
  ) {
    return { approved: false, reason: 'DEMO_CONNECTION_REQUIRED' };
  }

  if (evidence.status !== 'EXACT') {
    return { approved: false, reason: 'EXACT_COHORT_REQUIRED' };
  }

  if (evidence.freshness !== 'FRESH') {
    return { approved: false, reason: 'EVIDENCE_STALE' };
  }

  if (evidence.calibrationQuality !== 'GOOD') {
    return { approved: false, reason: 'CALIBRATION_UNRELIABLE' };
  }

  if (evidence.expectedNetR <= 0) {
    return { approved: false, reason: 'NEGATIVE_EXPECTED_NET_R' };
  }

  if (positionContext.activeProbesOnSymbol > 0) {
    return { approved: false, reason: 'SYMBOL_PROBE_ACTIVE' };
  }

  const maxAccountPositions = input.maxAccountPositions ?? 2;
  if (positionContext.totalAccountPositions >= maxAccountPositions) {
    return { approved: false, reason: 'ACCOUNT_POSITION_LIMIT_REACHED' };
  }

  if (positionContext.lastProbeCompletedAt) {
    const lastCompletedMs = typeof positionContext.lastProbeCompletedAt === 'string'
      ? Date.parse(positionContext.lastProbeCompletedAt)
      : positionContext.lastProbeCompletedAt.getTime();
    const cooldownMs = input.cooldownMs ?? 3_600_000;
    if (Date.now() - lastCompletedMs < cooldownMs) {
      return { approved: false, reason: 'PROBE_COOLDOWN_ACTIVE' };
    }
  }

  if (
    input.chaseDistanceAtr !== undefined &&
    input.maxChaseDistanceAtr !== undefined &&
    input.chaseDistanceAtr > input.maxChaseDistanceAtr
  ) {
    return { approved: false, reason: 'CHASE_DISTANCE_EXCEEDED' };
  }

  if (input.riskApproved === false) {
    return { approved: false, reason: 'RISK_REJECTED' };
  }

  const sizeFactor = Math.min(input.maxSizeFactor ?? 0.10, 0.10);
  return { approved: true, sizeFactor };
}
