import type { RecoveryCohortReport } from './recovery-cohort-evaluation';

export interface WalkForwardFold {
  foldIndex: number;
  sampleSize: number;
  meanNetR: number;
  profitFactor: number;
}

export interface RecoveryPromotionPolicyThresholds {
  minSampleSize: number;
  minProfitFactor: number;
  minLowerConfidenceBoundNetR: number;
  maxDrawdownPct: number;
  requireFoldCount: number;
  minFoldProfitFactor: number;
  minFoldMeanNetR: number;
}

export const DEFAULT_RECOVERY_PROMOTION_THRESHOLDS: RecoveryPromotionPolicyThresholds = Object.freeze({
  minSampleSize: 100,
  minProfitFactor: 1.20,
  minLowerConfidenceBoundNetR: 0.0,
  maxDrawdownPct: 15.0,
  requireFoldCount: 3,
  minFoldProfitFactor: 1.0,
  minFoldMeanNetR: 0.0,
});

export const RECOVERY_PROMOTION_REASONS = {
  INSUFFICIENT_SAMPLES: 'RECOVERY_INSUFFICIENT_SAMPLES',
  NEGATIVE_LCB_NET_R: 'RECOVERY_NEGATIVE_LCB_NET_R',
  PROFIT_FACTOR_BELOW_THRESHOLD: 'RECOVERY_PROFIT_FACTOR_BELOW_THRESHOLD',
  WALK_FORWARD_FOLDS_UNSTABLE: 'RECOVERY_WALK_FORWARD_FOLDS_UNSTABLE',
  CALIBRATION_UNRELIABLE: 'RECOVERY_CALIBRATION_UNRELIABLE',
  DRAWDOWN_EXCEEDED: 'RECOVERY_DRAWDOWN_EXCEEDED',
  DOUBLED_COST_FAILED: 'RECOVERY_DOUBLED_COST_FAILED',
  UNRESOLVED_INCIDENTS: 'RECOVERY_UNRESOLVED_INCIDENTS',
} as const;

export interface RecoveryPromotionInput {
  report: RecoveryCohortReport;
  walkForwardFolds?: WalkForwardFold[];
  calibrationQuality: 'GOOD' | 'UNRELIABLE' | 'DEGRADED';
  unresolvedIncidentsCount?: number;
  maxDrawdownPct?: number;
  policyThresholds?: Partial<RecoveryPromotionPolicyThresholds>;
}

export interface RecoveryPromotionResult {
  eligible: boolean;
  reasons: string[];
}

export function evaluateRecoveryPromotion(
  input: RecoveryPromotionInput,
): RecoveryPromotionResult {
  const thresholds: RecoveryPromotionPolicyThresholds = {
    ...DEFAULT_RECOVERY_PROMOTION_THRESHOLDS,
    ...input.policyThresholds,
  };

  const reasons: string[] = [];

  if (input.report.sampleSize < thresholds.minSampleSize) {
    reasons.push(RECOVERY_PROMOTION_REASONS.INSUFFICIENT_SAMPLES);
  }

  if (input.report.lowerConfidenceBoundNetR <= thresholds.minLowerConfidenceBoundNetR) {
    reasons.push(RECOVERY_PROMOTION_REASONS.NEGATIVE_LCB_NET_R);
  }

  if (input.report.profitFactor < thresholds.minProfitFactor) {
    reasons.push(RECOVERY_PROMOTION_REASONS.PROFIT_FACTOR_BELOW_THRESHOLD);
  }

  const folds = input.walkForwardFolds ?? [];
  if (folds.length < thresholds.requireFoldCount) {
    reasons.push(RECOVERY_PROMOTION_REASONS.WALK_FORWARD_FOLDS_UNSTABLE);
  } else {
    const unstable = folds.some(
      (f) => f.profitFactor < thresholds.minFoldProfitFactor || f.meanNetR <= thresholds.minFoldMeanNetR,
    );
    if (unstable) {
      reasons.push(RECOVERY_PROMOTION_REASONS.WALK_FORWARD_FOLDS_UNSTABLE);
    }
  }

  if (input.calibrationQuality !== 'GOOD') {
    reasons.push(RECOVERY_PROMOTION_REASONS.CALIBRATION_UNRELIABLE);
  }

  if (
    input.maxDrawdownPct !== undefined &&
    input.maxDrawdownPct > thresholds.maxDrawdownPct
  ) {
    reasons.push(RECOVERY_PROMOTION_REASONS.DRAWDOWN_EXCEEDED);
  }

  if (!input.report.sensitivity.doubledCostResilient) {
    reasons.push(RECOVERY_PROMOTION_REASONS.DOUBLED_COST_FAILED);
  }

  if (
    input.unresolvedIncidentsCount !== undefined &&
    input.unresolvedIncidentsCount > 0
  ) {
    reasons.push(RECOVERY_PROMOTION_REASONS.UNRESOLVED_INCIDENTS);
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}
