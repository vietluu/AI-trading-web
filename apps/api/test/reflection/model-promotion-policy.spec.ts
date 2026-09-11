import { describe, expect, it } from 'vitest';
import {
  evaluatePromotionTransition,
  calculateLifecycleHeadlineMetrics,
  type LifecyclePromotionMetrics,
  type PromotionTransitionInput,
  type OperatorApprovalRecord,
} from '../../src/modules/reflection/domain/model-promotion-policy';
import type { TradeLifecycleOutcome } from '../../src/modules/research/domain/trade-lifecycle';

describe('ModelPromotionPolicy state machine', () => {
  const frozenConfigHash = 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0';
  const trainingSampleIds = Array.from({ length: 100 }, (_, i) => `train-sample-${i}`);
  const validForwardSampleIds = Array.from({ length: 60 }, (_, i) => `forward-sample-${i}`);

  const passingMetrics: LifecyclePromotionMetrics = {
    sampleSize: 60,
    forwardSampleIds: validForwardSampleIds,
    trainingSampleIds,
    lifecycleExpectancyNetR: 0.35,
    profitFactor: 1.65,
    markToMarketDrawdownPct: 5.2,
    chaseRate: 0.08,
    cohortStabilityScore: 0.85,
    protectionFailuresCount: 0,
    modelDriftDetected: false,
    driftScore: 0.05,
    legacyFixedHorizon: {
      accuracy: 62.5,
      sharpeRatio: 1.2,
      totalReturn: 18.4,
      tradesCount: 60,
    },
  };

  const validApproval: OperatorApprovalRecord = {
    operatorId: 'operator-alice-uuid',
    approvedAt: new Date('2026-09-10T12:00:00Z'),
    configurationHash: frozenConfigHash,
    confirmed: true,
    notes: 'Approved after successful canary period and verified risk budget',
  };

  describe('Happy Path State Transitions', () => {
    it('transitions OBSERVE -> SHADOW when candidate configuration and untouched forward samples are registered', () => {
      const input: PromotionTransitionInput = {
        currentStage: 'OBSERVE',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          sampleSize: 60,
          forwardSampleIds: validForwardSampleIds,
          trainingSampleIds,
          lifecycleExpectancyNetR: 0,
          profitFactor: 1.0,
          markToMarketDrawdownPct: 0,
          chaseRate: 0,
          cohortStabilityScore: 1.0,
          protectionFailuresCount: 0,
        },
      };

      const result = evaluatePromotionTransition(input);

      expect(result.allowed).toBe(true);
      expect(result.fromStage).toBe('OBSERVE');
      expect(result.toStage).toBe('SHADOW');
      expect(result.isRollback).toBe(false);
      expect(result.failures).toHaveLength(0);
    });

    it('transitions SHADOW -> DEMO_CANARY when shadow lifecycle metrics pass all gates', () => {
      const input: PromotionTransitionInput = {
        currentStage: 'SHADOW',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: passingMetrics,
      };

      const result = evaluatePromotionTransition(input);

      expect(result.allowed).toBe(true);
      expect(result.fromStage).toBe('SHADOW');
      expect(result.toStage).toBe('DEMO_CANARY');
      expect(result.isRollback).toBe(false);
      expect(result.failures).toHaveLength(0);
    });

    it('transitions DEMO_CANARY -> ELIGIBLE and freezes configuration hash when canary criteria pass', () => {
      const input: PromotionTransitionInput = {
        currentStage: 'DEMO_CANARY',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: passingMetrics,
      };

      const result = evaluatePromotionTransition(input);

      expect(result.allowed).toBe(true);
      expect(result.fromStage).toBe('DEMO_CANARY');
      expect(result.toStage).toBe('ELIGIBLE');
      expect(result.isRollback).toBe(false);
      expect(result.configurationHash).toBe(frozenConfigHash);
      expect(result.failures).toHaveLength(0);
    });

    it('transitions ELIGIBLE -> APPROVED_LIVE_CANARY strictly with a valid confirmed operator approval record matching hash', () => {
      const input: PromotionTransitionInput = {
        currentStage: 'ELIGIBLE',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: passingMetrics,
        operatorApproval: validApproval,
      };

      const result = evaluatePromotionTransition(input);

      expect(result.allowed).toBe(true);
      expect(result.fromStage).toBe('ELIGIBLE');
      expect(result.toStage).toBe('APPROVED_LIVE_CANARY');
      expect(result.isRollback).toBe(false);
      expect(result.configurationHash).toBe(frozenConfigHash);
      expect(result.failures).toHaveLength(0);
    });
  });

  describe('Rejection and Blocking Gates', () => {
    it('blocks promotion on insufficient sample size (< required sample threshold)', () => {
      const smallSampleIds = Array.from({ length: 25 }, (_, i) => `forward-sample-${i}`);
      const input: PromotionTransitionInput = {
        currentStage: 'SHADOW',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          sampleSize: 25,
          forwardSampleIds: smallSampleIds,
        },
        thresholds: { minSampleSize: 50 },
      };

      const result = evaluatePromotionTransition(input);

      expect(result.allowed).toBe(false);
      expect(result.toStage).toBe('SHADOW');
      expect(result.failures).toContain('INSUFFICIENT_SAMPLE_SIZE');
    });

    it('blocks promotion when forward sample IDs are contaminated with in-sample/training IDs or contain duplicates', () => {
      const contaminatedIds = ['train-sample-1', 'train-sample-2', ...validForwardSampleIds.slice(2)];
      const input: PromotionTransitionInput = {
        currentStage: 'SHADOW',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          forwardSampleIds: contaminatedIds,
        },
      };

      const result = evaluatePromotionTransition(input);

      expect(result.allowed).toBe(false);
      expect(result.failures).toContain('FORWARD_SAMPLE_CONTAMINATED');

      const duplicateIds = ['forward-sample-0', 'forward-sample-0', ...validForwardSampleIds.slice(2)];
      const duplicateInput: PromotionTransitionInput = {
        currentStage: 'SHADOW',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          forwardSampleIds: duplicateIds,
        },
      };

      const duplicateResult = evaluatePromotionTransition(duplicateInput);
      expect(duplicateResult.allowed).toBe(false);
      expect(duplicateResult.failures).toContain('FORWARD_SAMPLE_DUPLICATES');
    });

    it('blocks promotion on Profit Factor or Expectancy failure (negative/zero expectancy or PF < threshold)', () => {
      const negativeExpInput: PromotionTransitionInput = {
        currentStage: 'SHADOW',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          lifecycleExpectancyNetR: -0.12,
        },
      };

      const resExp = evaluatePromotionTransition(negativeExpInput);
      expect(resExp.allowed).toBe(false);
      expect(resExp.failures).toContain('NEGATIVE_OR_ZERO_EXPECTANCY');

      const lowPfInput: PromotionTransitionInput = {
        currentStage: 'SHADOW',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          profitFactor: 1.15, // Below default 1.3
        },
      };

      const resPf = evaluatePromotionTransition(lowPfInput);
      expect(resPf.allowed).toBe(false);
      expect(resPf.failures).toContain('PROFIT_FACTOR_BELOW_THRESHOLD');
    });

    it('blocks promotion on mark-to-market drawdown breach exceeding ceiling', () => {
      const input: PromotionTransitionInput = {
        currentStage: 'SHADOW',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          markToMarketDrawdownPct: 14.8, // Exceeds default 10.0%
        },
      };

      const result = evaluatePromotionTransition(input);

      expect(result.allowed).toBe(false);
      expect(result.failures).toContain('DRAWDOWN_BREACH');
    });

    it('blocks promotion on protection failure (any trade omitted mandatory stopLoss)', () => {
      const input: PromotionTransitionInput = {
        currentStage: 'SHADOW',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          protectionFailuresCount: 1, // Any omission of stopLoss is an immediate failure
        },
      };

      const result = evaluatePromotionTransition(input);

      expect(result.allowed).toBe(false);
      expect(result.failures).toContain('PROTECTION_FAILURE');
    });

    it('blocks promotion on model drift detection', () => {
      const input: PromotionTransitionInput = {
        currentStage: 'SHADOW',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          modelDriftDetected: true,
          driftScore: 0.42,
        },
      };

      const result = evaluatePromotionTransition(input);

      expect(result.allowed).toBe(false);
      expect(result.failures).toContain('MODEL_DRIFT_DETECTED');
    });

    it('blocks promotion when chase rate exceeds ceiling or cohort stability is poor', () => {
      const input: PromotionTransitionInput = {
        currentStage: 'SHADOW',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          chaseRate: 0.35, // Exceeds max 0.25
          cohortStabilityScore: 0.45, // Below min 0.60
        },
      };

      const result = evaluatePromotionTransition(input);

      expect(result.allowed).toBe(false);
      expect(result.failures).toContain('CHASE_RATE_EXCEEDS_CEILING');
      expect(result.failures).toContain('COHORT_STABILITY_BELOW_THRESHOLD');
    });
  });

  describe('Automatic Rollback to SHADOW', () => {
    it('automatically rolls back DEMO_CANARY to SHADOW on drawdown breach', () => {
      const input: PromotionTransitionInput = {
        currentStage: 'DEMO_CANARY',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          markToMarketDrawdownPct: 15.5,
        },
      };

      const result = evaluatePromotionTransition(input);

      expect(result.toStage).toBe('SHADOW');
      expect(result.isRollback).toBe(true);
      expect(result.failures).toContain('DRAWDOWN_BREACH');
      expect(result.reasons).toContain('AUTOMATIC_ROLLBACK_TO_SHADOW');
    });

    it('automatically rolls back DEMO_CANARY to SHADOW on protection failure (omitted stopLoss)', () => {
      const input: PromotionTransitionInput = {
        currentStage: 'DEMO_CANARY',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          protectionFailuresCount: 2,
        },
      };

      const result = evaluatePromotionTransition(input);

      expect(result.toStage).toBe('SHADOW');
      expect(result.isRollback).toBe(true);
      expect(result.failures).toContain('PROTECTION_FAILURE');
      expect(result.reasons).toContain('AUTOMATIC_ROLLBACK_TO_SHADOW');
    });

    it('automatically rolls back DEMO_CANARY to SHADOW on model drift', () => {
      const input: PromotionTransitionInput = {
        currentStage: 'DEMO_CANARY',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          modelDriftDetected: true,
          driftScore: 0.38,
        },
      };

      const result = evaluatePromotionTransition(input);

      expect(result.toStage).toBe('SHADOW');
      expect(result.isRollback).toBe(true);
      expect(result.failures).toContain('MODEL_DRIFT_DETECTED');
    });

    it('automatically rolls back ELIGIBLE to SHADOW on severe regression or protection breach', () => {
      const input: PromotionTransitionInput = {
        currentStage: 'ELIGIBLE',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          lifecycleExpectancyNetR: -0.05,
          protectionFailuresCount: 1,
        },
        operatorApproval: validApproval,
      };

      const result = evaluatePromotionTransition(input);

      expect(result.toStage).toBe('SHADOW');
      expect(result.isRollback).toBe(true);
      expect(result.failures).toContain('NEGATIVE_OR_ZERO_EXPECTANCY');
      expect(result.failures).toContain('PROTECTION_FAILURE');
    });

    it('automatically rolls back APPROVED_LIVE_CANARY to SHADOW on failure or drawdown breach', () => {
      const input: PromotionTransitionInput = {
        currentStage: 'APPROVED_LIVE_CANARY',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: {
          ...passingMetrics,
          markToMarketDrawdownPct: 12.0,
          modelDriftDetected: true,
        },
      };

      const result = evaluatePromotionTransition(input);

      expect(result.toStage).toBe('SHADOW');
      expect(result.isRollback).toBe(true);
      expect(result.failures).toContain('DRAWDOWN_BREACH');
      expect(result.failures).toContain('MODEL_DRIFT_DETECTED');
      expect(result.reasons).toContain('AUTOMATIC_ROLLBACK_TO_SHADOW');
    });
  });

  describe('Explicit Approval Requirement for APPROVED_LIVE_CANARY', () => {
    it('strictly requires a distinct explicit operator approval record before moving from ELIGIBLE to APPROVED_LIVE_CANARY', () => {
      const inputWithoutApproval: PromotionTransitionInput = {
        currentStage: 'ELIGIBLE',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: passingMetrics,
        operatorApproval: null,
      };

      const result = evaluatePromotionTransition(inputWithoutApproval);

      expect(result.allowed).toBe(false);
      expect(result.toStage).toBe('ELIGIBLE');
      expect(result.failures).toContain('OPERATOR_APPROVAL_REQUIRED');
    });

    it('blocks promotion if operator approval confirmed flag is false', () => {
      const unconfirmedApproval: OperatorApprovalRecord = {
        ...validApproval,
        confirmed: false,
      };

      const input: PromotionTransitionInput = {
        currentStage: 'ELIGIBLE',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: passingMetrics,
        operatorApproval: unconfirmedApproval,
      };

      const result = evaluatePromotionTransition(input);

      expect(result.allowed).toBe(false);
      expect(result.toStage).toBe('ELIGIBLE');
      expect(result.failures).toContain('OPERATOR_APPROVAL_NOT_CONFIRMED');
    });

    it('blocks promotion if operator approval configuration hash does not match the frozen candidate hash', () => {
      const staleApproval: OperatorApprovalRecord = {
        ...validApproval,
        configurationHash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      };

      const input: PromotionTransitionInput = {
        currentStage: 'ELIGIBLE',
        candidateVersion: 2,
        configurationHash: frozenConfigHash,
        metrics: passingMetrics,
        operatorApproval: staleApproval,
      };

      const result = evaluatePromotionTransition(input);

      expect(result.allowed).toBe(false);
      expect(result.toStage).toBe('ELIGIBLE');
      expect(result.failures).toContain('OPERATOR_APPROVAL_HASH_MISMATCH');
    });
  });

  describe('calculateLifecycleHeadlineMetrics', () => {
    it('calculates lifecycle expectancy, Profit Factor, mark-to-market drawdown, chase rate, and cohort stability from outcomes while keeping legacy metrics separate', () => {
      const outcomes: TradeLifecycleOutcome[] = [
        {
          thesisId: 'thesis-1',
          symbol: 'BTCUSDT',
          provider: 'BINANCE_FUTURES',
          timeframe: '1h',
          direction: 'LONG',
          setup: 'BREAKOUT',
          status: 'FINALIZED',
          sourceDataCutoff: new Date('2026-09-01T00:00:00Z'),
          openedAt: new Date('2026-09-01T01:00:00Z'),
          closedAt: new Date('2026-09-01T05:00:00Z'),
          totalEnteredQuantity: 1,
          totalExitedQuantity: 1,
          averageEntryPrice: 50000,
          averageExitPrice: 51500,
          realizedGrossPnl: 1500,
          signedFees: -10,
          signedFunding: -5,
          realizedNetPnl: 1485,
          initialRisk: 500,
          netR: 2.97,
          finalStopLoss: 49500,
          schemaVersion: 1,
          calculationVersion: 1,
          configurationHash: frozenConfigHash,
          metadata: { isChase: false, maxDrawdownPct: 0.5, cohortKey: 'BTCUSDT|1h|BULL|LONG|BREAKOUT|v1' },
        },
        {
          thesisId: 'thesis-2',
          symbol: 'BTCUSDT',
          provider: 'BINANCE_FUTURES',
          timeframe: '1h',
          direction: 'LONG',
          setup: 'BREAKOUT',
          status: 'FINALIZED',
          sourceDataCutoff: new Date('2026-09-02T00:00:00Z'),
          openedAt: new Date('2026-09-02T01:00:00Z'),
          closedAt: new Date('2026-09-02T03:00:00Z'),
          totalEnteredQuantity: 1,
          totalExitedQuantity: 1,
          averageEntryPrice: 52000,
          averageExitPrice: 51500,
          realizedGrossPnl: -500,
          signedFees: -10,
          signedFunding: 0,
          realizedNetPnl: -510,
          initialRisk: 500,
          netR: -1.02,
          finalStopLoss: 51500,
          schemaVersion: 1,
          calculationVersion: 1,
          configurationHash: frozenConfigHash,
          metadata: { isChase: true, maxDrawdownPct: 1.02, cohortKey: 'BTCUSDT|1h|BULL|LONG|BREAKOUT|v1' },
        },
        {
          thesisId: 'thesis-3',
          symbol: 'ETHUSDT',
          provider: 'BINANCE_FUTURES',
          timeframe: '1h',
          direction: 'SHORT',
          setup: 'REVERSAL',
          status: 'FINALIZED',
          sourceDataCutoff: new Date('2026-09-03T00:00:00Z'),
          openedAt: new Date('2026-09-03T01:00:00Z'),
          closedAt: new Date('2026-09-03T06:00:00Z'),
          totalEnteredQuantity: 10,
          totalExitedQuantity: 10,
          averageEntryPrice: 3000,
          averageExitPrice: 2900,
          realizedGrossPnl: 1000,
          signedFees: -15,
          signedFunding: 5,
          realizedNetPnl: 990,
          initialRisk: 500,
          netR: 1.98,
          finalStopLoss: 3050,
          schemaVersion: 1,
          calculationVersion: 1,
          configurationHash: frozenConfigHash,
          metadata: { isChase: false, maxDrawdownPct: 0.3, cohortKey: 'ETHUSDT|1h|BEAR|SHORT|REVERSAL|v1' },
        },
      ];

      const metrics = calculateLifecycleHeadlineMetrics(outcomes, {
        legacyHorizonRecords: [
          { outcome: 'CORRECT', returnPct: 2.5 },
          { outcome: 'WRONG', returnPct: -1.0 },
          { outcome: 'CORRECT', returnPct: 1.8 },
        ],
      });

      expect(metrics.sampleSize).toBe(3);
      expect(metrics.forwardSampleIds).toEqual(['thesis-1', 'thesis-2', 'thesis-3']);
      // Expected net R = (2.97 - 1.02 + 1.98) / 3 = 1.31
      expect(metrics.lifecycleExpectancyNetR).toBeCloseTo(1.31, 2);
      // Profit factor = (1485 + 990) / 510 = 2475 / 510 = 4.85
      expect(metrics.profitFactor).toBeCloseTo(4.85, 2);
      // Chase rate = 1 chase out of 3 = 0.333
      expect(metrics.chaseRate).toBeCloseTo(0.333, 2);
      // Mark-to-market drawdown is a percentage relative to equity curve (e.g. ~4.44%), NOT raw nominal dollars ($510)
      expect(metrics.markToMarketDrawdownPct).toBeCloseTo(4.44, 1);
      expect(metrics.markToMarketDrawdownPct).toBeLessThan(10);
      // Protection failures = 0 (all had stopLoss)
      expect(metrics.protectionFailuresCount).toBe(0);
      expect(metrics.cohortStabilityScore).toBeGreaterThan(0);
      // Legacy metrics labeled separately
      expect(metrics.legacyFixedHorizon).toBeDefined();
      expect(metrics.legacyFixedHorizon?.accuracy).toBeCloseTo(66.67, 1);
      expect(metrics.legacyFixedHorizon?.tradesCount).toBe(3);
    });

    it('calculates markToMarketDrawdownPct as percentage of equity rather than raw dollar drawdown', () => {
      const losingOutcomes: TradeLifecycleOutcome[] = [
        {
          thesisId: 'thesis-loss-1',
          symbol: 'BTCUSDT',
          provider: 'BINANCE_FUTURES',
          timeframe: '1h',
          direction: 'LONG',
          status: 'FINALIZED',
          sourceDataCutoff: new Date('2026-09-01T00:00:00Z'),
          openedAt: new Date('2026-09-01T01:00:00Z'),
          closedAt: new Date('2026-09-01T02:00:00Z'),
          totalEnteredQuantity: 1,
          totalExitedQuantity: 1,
          averageEntryPrice: 50000,
          averageExitPrice: 49500,
          realizedGrossPnl: -500,
          signedFees: -10,
          signedFunding: 0,
          realizedNetPnl: -510,
          initialRisk: 500,
          netR: -1.02,
          finalStopLoss: 49500,
          schemaVersion: 1,
          calculationVersion: 1,
          configurationHash: frozenConfigHash,
        },
      ];

      // On $10,000 capital, -$510 net loss is 5.1% drawdown, NOT 510%!
      const metrics = calculateLifecycleHeadlineMetrics(losingOutcomes, { initialCapital: 10_000 });
      expect(metrics.markToMarketDrawdownPct).toBeCloseTo(5.1, 1);
      expect(metrics.markToMarketDrawdownPct).toBeLessThan(10);
    });

    it('detects protection failure when an outcome omitted mandatory stopLoss', () => {
      const outcomesWithOmission: TradeLifecycleOutcome[] = [
        {
          thesisId: 'thesis-no-stop',
          symbol: 'SOLUSDT',
          provider: 'BINANCE_FUTURES',
          timeframe: '15m',
          direction: 'LONG',
          status: 'FINALIZED',
          sourceDataCutoff: new Date('2026-09-01T00:00:00Z'),
          openedAt: new Date('2026-09-01T01:00:00Z'),
          closedAt: new Date('2026-09-01T02:00:00Z'),
          totalEnteredQuantity: 5,
          totalExitedQuantity: 5,
          averageEntryPrice: 150,
          averageExitPrice: 140,
          realizedGrossPnl: -50,
          signedFees: -2,
          signedFunding: 0,
          realizedNetPnl: -52,
          initialRisk: null,
          netR: null,
          finalStopLoss: null, // OMITTED STOP LOSS!
          schemaVersion: 1,
          calculationVersion: 1,
          configurationHash: frozenConfigHash,
          metadata: { omittedStopLoss: true },
        },
      ];

      const metrics = calculateLifecycleHeadlineMetrics(outcomesWithOmission);
      expect(metrics.protectionFailuresCount).toBe(1);
    });
  });
});
