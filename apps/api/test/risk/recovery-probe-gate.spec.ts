import { describe, expect, it } from 'vitest';
import {
  evaluateRecoveryProbe,
  type RecoveryProbeGateInput,
} from '../../src/modules/risk/domain/recovery-probe-gate';

describe('evaluateRecoveryProbe', () => {
  const eligibleInput: RecoveryProbeGateInput = {
    enabled: true,
    maxSizeFactor: 0.10,
    maxAccountPositions: 2,
    cooldownMs: 3600_000,
    connection: {
      provider: 'OKX_FUTURES',
      environment: 'DEMO',
      isVerified: true,
    },
    evidence: {
      status: 'EXACT',
      cohortStatus: 'IMMATURE',
      sampleCount: 5,
      freshness: 'FRESH',
      expectedNetR: 1.5,
      calibrationQuality: 'GOOD',
    },
    positionContext: {
      activeProbesOnSymbol: 0,
      totalAccountPositions: 0,
    },
    chaseDistanceAtr: 0.2,
    maxChaseDistanceAtr: 0.5,
    riskApproved: true,
  };

  it('rejects when feature flag is disabled', () => {
    const result = evaluateRecoveryProbe({
      ...eligibleInput,
      enabled: false,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('RECOVERY_DEMO_PROBE_DISABLED');
  });

  it('rejects production environment or unverified connection', () => {
    const prodResult = evaluateRecoveryProbe({
      ...eligibleInput,
      connection: {
        provider: 'OKX_FUTURES',
        environment: 'PRODUCTION',
        isVerified: true,
      },
    });
    expect(prodResult.approved).toBe(false);
    expect(prodResult.reason).toBe('DEMO_CONNECTION_REQUIRED');

    const unverifiedResult = evaluateRecoveryProbe({
      ...eligibleInput,
      connection: {
        provider: 'OKX_FUTURES',
        environment: 'DEMO',
        isVerified: false,
      },
    });
    expect(unverifiedResult.approved).toBe(false);
    expect(unverifiedResult.reason).toBe('DEMO_CONNECTION_REQUIRED');
  });

  it('rejects partial, unsupported, stale, or negative evidence', () => {
    expect(evaluateRecoveryProbe({
      ...eligibleInput,
      evidence: { ...eligibleInput.evidence, status: 'UNSUPPORTED' },
    })).toMatchObject({ approved: false, reason: 'EXACT_COHORT_REQUIRED' });

    expect(evaluateRecoveryProbe({
      ...eligibleInput,
      evidence: { ...eligibleInput.evidence, freshness: 'STALE' },
    })).toMatchObject({ approved: false, reason: 'EVIDENCE_STALE' });

    expect(evaluateRecoveryProbe({
      ...eligibleInput,
      evidence: { ...eligibleInput.evidence, expectedNetR: -0.2 },
    })).toMatchObject({ approved: false, reason: 'NEGATIVE_EXPECTED_NET_R' });
  });

  it('rejects unreliable calibration quality', () => {
    const result = evaluateRecoveryProbe({
      ...eligibleInput,
      evidence: { ...eligibleInput.evidence, calibrationQuality: 'UNRELIABLE' },
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('CALIBRATION_UNRELIABLE');
  });

  it('rejects open-symbol probe and account position limit >= 2', () => {
    expect(evaluateRecoveryProbe({
      ...eligibleInput,
      positionContext: { ...eligibleInput.positionContext, activeProbesOnSymbol: 1 },
    })).toMatchObject({ approved: false, reason: 'SYMBOL_PROBE_ACTIVE' });

    expect(evaluateRecoveryProbe({
      ...eligibleInput,
      positionContext: { ...eligibleInput.positionContext, totalAccountPositions: 2 },
    })).toMatchObject({ approved: false, reason: 'ACCOUNT_POSITION_LIMIT_REACHED' });
  });

  it('rejects during cooldown window', () => {
    const recentlyCompleted = new Date(Date.now() - 30 * 60_000); // 30 mins ago, cooldown is 60 mins
    const result = evaluateRecoveryProbe({
      ...eligibleInput,
      positionContext: {
        ...eligibleInput.positionContext,
        lastProbeCompletedAt: recentlyCompleted,
      },
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('PROBE_COOLDOWN_ACTIVE');
  });

  it('rejects when chase distance exceeds maximum', () => {
    const result = evaluateRecoveryProbe({
      ...eligibleInput,
      chaseDistanceAtr: 0.8,
      maxChaseDistanceAtr: 0.5,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('CHASE_DISTANCE_EXCEEDED');
  });

  it('rejects when Risk engine rejected', () => {
    const result = evaluateRecoveryProbe({
      ...eligibleInput,
      riskApproved: false,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('RISK_REJECTED');
  });

  it('returns sizeFactor 0.10 when all conditions are satisfied and explicitly enabled', () => {
    const result = evaluateRecoveryProbe(eligibleInput);
    expect(result.approved).toBe(true);
    expect(result.sizeFactor).toBe(0.10);
  });
});
