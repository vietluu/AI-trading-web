import { describe, expect, it } from "vitest";
import { evaluateRisk } from "../../src/modules/risk/domain/risk-engine";
import { buildAdaptiveTradePlan } from "../../src/modules/risk/domain/trade-plan-engine";
import type { RiskInput, RiskLimits } from "../../src/modules/risk/domain/risk-engine.types";

const defaultLimits: RiskLimits = {
  riskPerTrade: 0.005, // 0.50%
  maxPositions: 3,
  maxLeverage: 10,
  maxDrawdown: 0.1,
  maxExposure: 0.5,
  cooldownMs: 0,
  minimumConfidence: 60,
  stopLossPct: 0.02,
  riskRewardRatio: 2,
  highVolatility: 5,
  abnormalVolatility: 10,
  highVolatilitySizeFactor: 0.5,
  estimatedRoundTripCostPct: 0.001,
  maxStopLossRoe: 0.5,
  rangeScalpRoeMultiplier: 1.5,
  minLiquidationBufferPct: 0.01,
};

const getBaseInput = (decision: 'LONG' | 'SHORT', currentPositions: any[] = []): RiskInput => ({
  symbol: 'BTC-USDT',
  account: { balance: 10000, equity: 10000, peakEquity: 10000 },
  currentPositions,
  decision: {
    decision,
    confidence: 80,
    regime: { type: 'TRENDING_BULL' },
    expectedValue: 1,
    expectedLoss: 1,
    expectedReward: 2,
    riskScore: 20,
    opportunityScore: 80,
  } as any,
  marketData: {
    price: 100000,
    volatility: 0.01,
    tradePlanContext: {
      gateSeverity: 'APPROVE', 
      support: 98000,
      resistance: 104000,
      marketStructure: 'HH_HL',
      timeframeMs: 3600000,
      candleClose: 100000,
    },
  },
  now: new Date(),
});

describe("Staged Entry Risk Evaluation", () => {
  it("calculates probe order size at 25% if APPROVE gate severity", () => {
    const input = getBaseInput('LONG');
    const risk = evaluateRisk(input, defaultLimits);
    if (!risk.approved) console.log(risk);
    expect(risk.approved).toBe(true);
    expect(risk.tradePlan?.stagedEntry).toBeDefined();
    expect(risk.tradePlan?.stagedEntry?.probeSizePct).toBe(0.25);
    expect(risk.tradePlan?.stagedEntry?.stage).toBe('PROBE');
    // Position size check: 0.25 scaling
    expect(risk.positionSize).toBeGreaterThan(0.005);
    expect(risk.positionSize).toBeLessThan(0.007); // ~0.00625
  });

  it("calculates probe order size at 20% if REDUCE_SIZE gate severity", () => {
    const input = getBaseInput('LONG');
    input.marketData.tradePlanContext!.gateSeverity = 'REDUCE_SIZE';
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.approved).toBe(true);
    expect(risk.tradePlan?.stagedEntry?.probeSizePct).toBe(0.20);
    expect(risk.positionSize).toBeLessThan(0.0052); // ~0.005
  });

  it("rejects unplanned averaging down (missing stagedEntry)", () => {
    const input = getBaseInput('LONG', [{ symbol: 'BTC-USDT', side: 'LONG', size: 0.01, markPrice: 100000 }]);
    // Remove gateSeverity so it's not a staged entry
    input.marketData.tradePlanContext!.gateSeverity = undefined as any;
    
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.approved).toBe(false);
    expect(risk.reason).toBe('PYRAMIDING_NOT_ALLOWED');
  });

  it("allows CONFIRMED add and scales properly when existing position exists", () => {
    const input = getBaseInput('LONG', [{ symbol: 'BTC-USDT', side: 'LONG', size: 0.005, markPrice: 100000 }]);
    // Default base input has APPROVE which gives stagedEntry
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.approved).toBe(true);
    expect(risk.tradePlan?.stagedEntry?.stage).toBe('CONFIRMED');
    
    // confirmation size is 75% for APPROVE (probe 25%)
    expect(risk.tradePlan?.stagedEntry?.confirmationSizePct).toBe(0.75);
    expect(risk.positionSize).toBeGreaterThan(0.015); // ~0.01875
  });

  it("caps combined risk to 0.50% implicitly", () => {
    const input = getBaseInput('LONG', [{ symbol: 'BTC-USDT', side: 'LONG', size: 0.005, markPrice: 100000 }]);
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.tradePlan?.stagedEntry?.combinedRiskLimitPct).toBe(0.005);
  });
});
