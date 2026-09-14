import { describe, expect, it } from 'vitest';
import {
  evaluateRecoveryPromotion,
  type RecoveryPromotionInput,
  RECOVERY_PROMOTION_REASONS,
} from '../../src/modules/reflection/domain/recovery-promotion-policy';
import type { RecoveryCohortReport } from '../../src/modules/reflection/domain/recovery-cohort-evaluation';

describe('evaluateRecoveryPromotion', () => {
  const eligibleReport: RecoveryCohortReport = {
    sampleSize: 120,
    winCount: 72,
    lossCount: 48,
    scratchCount: 0,
    winRate: 0.60,
    meanNetR: 0.35,
    lowerConfidenceBoundNetR: 0.12,
    profitFactor: 1.45,
    grossProfit: 5000,
    grossLoss: 3448,
    maxDrawdown: 450,
    averageMfe: 200,
    averageMae: -80,
    stopBeforeTargetRate: 0.40,
    exclusions: { duplicateCount: 0, incompleteCount: 0, supersededCount: 0, corruptedCount: 0, totalExcluded: 0 },
    sensitivity: { doubledCostProfitFactor: 1.15, doubledCostMeanNetR: 0.10, doubledCostResilient: true },
  };

  const eligibleInput: RecoveryPromotionInput = {
    report: eligibleReport,
    walkForwardFolds: [
      { foldIndex: 1, sampleSize: 40, meanNetR: 0.30, profitFactor: 1.35 },
      { foldIndex: 2, sampleSize: 40, meanNetR: 0.40, profitFactor: 1.55 },
      { foldIndex: 3, sampleSize: 40, meanNetR: 0.35, profitFactor: 1.40 },
    ],
    calibrationQuality: 'GOOD',
    unresolvedIncidentsCount: 0,
    maxDrawdownPct: 8.5,
  };

  it('approves promotion when all predeclared conditions are met', () => {
    const result = evaluateRecoveryPromotion(eligibleInput);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('fails closed when sample size is below 100', () => {
    const result = evaluateRecoveryPromotion({
      ...eligibleInput,
      report: { ...eligibleReport, sampleSize: 85 },
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain(RECOVERY_PROMOTION_REASONS.INSUFFICIENT_SAMPLES);
  });

  it('fails closed when lower confidence bound of net R is not positive', () => {
    const result = evaluateRecoveryPromotion({
      ...eligibleInput,
      report: { ...eligibleReport, lowerConfidenceBoundNetR: -0.02 },
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain(RECOVERY_PROMOTION_REASONS.NEGATIVE_LCB_NET_R);
  });

  it('fails closed when profit factor is below 1.20', () => {
    const result = evaluateRecoveryPromotion({
      ...eligibleInput,
      report: { ...eligibleReport, profitFactor: 1.15 },
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain(RECOVERY_PROMOTION_REASONS.PROFIT_FACTOR_BELOW_THRESHOLD);
  });

  it('fails closed when walk-forward folds are insufficient or unstable', () => {
    // Fewer than 3 folds
    expect(evaluateRecoveryPromotion({
      ...eligibleInput,
      walkForwardFolds: eligibleInput.walkForwardFolds?.slice(0, 2),
    })).toMatchObject({ eligible: false, reasons: [RECOVERY_PROMOTION_REASONS.WALK_FORWARD_FOLDS_UNSTABLE] });

    // An unprofitable fold
    expect(evaluateRecoveryPromotion({
      ...eligibleInput,
      walkForwardFolds: [
        { foldIndex: 1, sampleSize: 40, meanNetR: 0.30, profitFactor: 1.35 },
        { foldIndex: 2, sampleSize: 40, meanNetR: -0.10, profitFactor: 0.85 },
        { foldIndex: 3, sampleSize: 40, meanNetR: 0.35, profitFactor: 1.40 },
      ],
    })).toMatchObject({ eligible: false, reasons: [RECOVERY_PROMOTION_REASONS.WALK_FORWARD_FOLDS_UNSTABLE] });
  });

  it('fails closed on unreliable calibration', () => {
    const result = evaluateRecoveryPromotion({
      ...eligibleInput,
      calibrationQuality: 'UNRELIABLE',
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain(RECOVERY_PROMOTION_REASONS.CALIBRATION_UNRELIABLE);
  });

  it('fails closed when drawdown exceeds threshold', () => {
    const result = evaluateRecoveryPromotion({
      ...eligibleInput,
      maxDrawdownPct: 18.0, // exceeds 15%
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain(RECOVERY_PROMOTION_REASONS.DRAWDOWN_EXCEEDED);
  });

  it('fails closed when doubled-cost sensitivity is not resilient', () => {
    const result = evaluateRecoveryPromotion({
      ...eligibleInput,
      report: {
        ...eligibleReport,
        sensitivity: { doubledCostProfitFactor: 0.95, doubledCostMeanNetR: -0.05, doubledCostResilient: false },
      },
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain(RECOVERY_PROMOTION_REASONS.DOUBLED_COST_FAILED);
  });

  it('fails closed on unresolved protection/provenance incidents', () => {
    const result = evaluateRecoveryPromotion({
      ...eligibleInput,
      unresolvedIncidentsCount: 1,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain(RECOVERY_PROMOTION_REASONS.UNRESOLVED_INCIDENTS);
  });
});
