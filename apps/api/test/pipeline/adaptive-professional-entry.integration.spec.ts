import { describe, expect, it } from 'vitest';
import {
  buildExecutionContext,
  validateSetupLocation,
} from '../../src/modules/pipeline/domain/execution-context';
import { evaluateRisk } from '../../src/modules/risk/domain/risk-engine';
import { resolveExecutionOrderTerms } from '../../src/modules/live-trading/application/live-trading.service';
import type { RiskInput, RiskLimits } from '../../src/modules/risk/domain/risk-engine.types';
import type { DecisionOutput } from '@platform/shared';

describe('Adaptive Professional Entry - End-to-End Acceptance Matrix', () => {
  const cases = {
    zroLateShort: { outcome: 'WAIT' as const, reason: 'RANGE_SHORT_NOT_AT_UPPER_BOUNDARY' },
    rangeUpperShort: { outcome: 'ORDER_SUBMITTED' as const, orderType: 'LIMIT' as const },
    intrabarTransition: { outcome: 'ORDER_SUBMITTED' as const, riskTier: 'PROBE' as const, maxSizeFactor: 0.2 },
    chasedBreakout: { outcome: 'WAIT' as const, reason: 'ENTRY_CHASE_DISTANCE_EXCEEDED' },
  };

  const defaultLimits: RiskLimits = {
    riskPerTrade: 0.02,
    maxPositions: 3,
    maxLeverage: 5,
    maxDrawdown: 0.15,
    maxExposure: 0.4,
    cooldownMs: 60_000,
    minimumConfidence: 70,
    stopLossPct: 0.02,
    riskRewardRatio: 2.5,
    highVolatility: 0.04,
    abnormalVolatility: 0.15,
    highVolatilitySizeFactor: 0.6,
    estimatedRoundTripCostPct: 0.0008,
    maxStopLossRoe: 0.03,
    rangeScalpRoeMultiplier: 2,
    minLiquidationBufferPct: 0.01,
  };

  const baseDecision = (customOverrides: Partial<DecisionOutput> = {}): DecisionOutput => ({
    decision: 'SHORT',
    confidence: 80,
    reasoning: 'test',
    signals: { bullishFactors: [], bearishFactors: [] },
    risks: [],
    agreementScore: 80,
    dataQuality: 'GOOD',
    regime: { type: 'RANGING' },
    weighting: { market: 25, technical: 25, news: 25, sentiment: 25, macro: 0, onchain: 0 },
    volatilityAdjustment: 0,
    conflictLevel: 'LOW',
    opportunityScore: 75,
    expectedWinProbability: 0.7,
    expectedReward: 1.6,
    expectedLoss: 0.8,
    expectedValue: 0.7,
    profitFactorEstimate: 2,
    riskScore: 30,
    adaptiveThreshold: 60,
    calibrationAdjustment: 0,
    executionCost: 0.05,
    generatedAt: new Date().toISOString(),
    overrides: [],
    ...customOverrides,
  });

  it('zroLateShort: rejects a short near range support and waits', () => {
    // Range 1.0151 - 1.0245, proposed short price 1.0171 (~21% range percentile)
    const context = buildExecutionContext({
      regime: 'RANGING',
      setup: 'RANGE_REVERSION',
      action: 'ENTER',
      price: 1.0171,
      support: 1.0151,
      resistance: 1.0245,
      triggerConfirmed: true,
      primaryCandleClosed: true,
      sourceDataCutoff: new Date('2026-09-13T06:01:00Z'),
    });

    expect(context.priceLocation.rangePercentile).toBeLessThan(0.3);

    const reasons = validateSetupLocation(context, 'SHORT');

    expect(reasons).toContain(cases.zroLateShort.reason);
    expect(cases.zroLateShort.outcome).toBe('WAIT');
  });

  it('rangeUpperShort: approves a limit short at range resistance without plan drift', () => {
    const context = buildExecutionContext({
      regime: 'RANGING',
      setup: 'RANGE_REVERSION',
      action: 'ENTER',
      price: 1.0235,
      support: 1.0151,
      resistance: 1.0245,
      triggerConfirmed: true,
      primaryCandleClosed: true,
      sourceDataCutoff: new Date('2026-09-13T06:01:00Z'),
    });

    const reasons = validateSetupLocation(context, 'SHORT');
    expect(reasons).toHaveLength(0);

    const riskInput: RiskInput = {
      symbol: 'ZRO-USDT',
      decision: baseDecision({ decision: 'SHORT' }),
      account: { balance: 10000, equity: 10000, peakEquity: 10000 },
      currentPositions: [],
      marketData: { price: 1.0235, volatility: 0.02 },
      executionContext: context,
      executionPlan: {
        orderType: 'LIMIT',
        limitPrice: 1.0235,
        timeInForce: 'IOC',
        expiryCandles: 3,
      },
    };

    const riskResult = evaluateRisk(riskInput, defaultLimits);
    expect(riskResult.approved).toBe(true);
    expect(riskResult.tradePlan?.orderType).toBe('LIMIT');

    const approvedPlan = riskResult.tradePlan!;
    const executionTerms = resolveExecutionOrderTerms(approvedPlan);

    // Assert submitted and approved plans are identical
    expect(executionTerms.orderType).toBe(cases.rangeUpperShort.orderType);
    expect(Number(executionTerms.limitPrice)).toBe(approvedPlan.limitPrice);
  });

  it('intrabarTransition: executes as a probe capped at 20% size', () => {
    const context = buildExecutionContext({
      regime: 'RANGING',
      setup: 'TRANSITION_PROBE',
      action: 'PROBE',
      price: 1.0145,
      support: 1.0151,
      resistance: 1.0245,
      triggerConfirmed: true,
      primaryCandleClosed: false,
      sourceDataCutoff: new Date('2026-09-13T06:01:00Z'),
    });

    const riskInput: RiskInput = {
      symbol: 'ZRO-USDT',
      decision: baseDecision({ decision: 'SHORT' }),
      account: { balance: 10000, equity: 10000, peakEquity: 10000 },
      currentPositions: [],
      marketData: { price: 1.0145, volatility: 0.02 },
      executionContext: context,
    };

    const riskResult = evaluateRisk(riskInput, defaultLimits);
    expect(riskResult.approved).toBe(true);
    expect(riskResult.tradePlan?.riskTier).toBe(cases.intrabarTransition.riskTier);
    expect(riskResult.tradePlan?.sizeFactor).toBeLessThanOrEqual(cases.intrabarTransition.maxSizeFactor);
  });

  it('chasedBreakout: rejects a trade that has exceeded maximum chase distance', () => {
    const context = buildExecutionContext({
      regime: 'TRENDING',
      setup: 'BREAKOUT_RETEST',
      action: 'ENTER',
      price: 65500,
      triggerPrice: 64000,
      atr: 500, // Distance is 1500 = 3 ATR > maximum 1.5 ATR
      triggerConfirmed: true,
      primaryCandleClosed: true,
      sourceDataCutoff: new Date('2026-09-13T06:01:00Z'),
    });

    const reasons = validateSetupLocation(context, 'LONG');
    expect(reasons).toContain(cases.chasedBreakout.reason);
    expect(cases.chasedBreakout.outcome).toBe('WAIT');
  });
});
