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
      squeezeState: {
        isSqueezing: true,
        momentumDirection: 'BULLISH',
        breakoutProbability: 75,
        consecutiveSqueezeBars: 10
      },
    },
  },
  now: new Date(),
});

describe("Proactive Thesis Integration (Risk Engine Focus)", () => {
  it("sideway boundary entry sets proper staged entry limits", () => {
    const input = getBaseInput('LONG');
    input.marketData.tradePlanContext!.marketStructure = 'RANGE';
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.approved).toBe(true);
    expect(risk.tradePlan?.stagedEntry).toBeDefined();
    // Range scalping may enforce breakEvenAtR or specific sizes, but at least stagedEntry exists
  });

  it("squeeze probe calculates probe order at 25% risk if not blocked", () => {
    const input = getBaseInput('LONG');
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.approved).toBe(true);
    expect(risk.tradePlan?.stagedEntry?.probeSizePct).toBe(0.25);
  });

  it("confirmation add scales properly for an existing position", () => {
    const input = getBaseInput('LONG', [{ symbol: 'BTC-USDT', side: 'LONG', size: 0.005, markPrice: 100000 }]);
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.approved).toBe(true);
    expect(risk.tradePlan?.stagedEntry?.stage).toBe('CONFIRMED');
    expect(risk.tradePlan?.stagedEntry?.confirmationSizePct).toBe(0.75);
  });

  it("prohibits unplanned averaging down (chase rejection / combined-risk cap)", () => {
    const input = getBaseInput('LONG', [{ symbol: 'BTC-USDT', side: 'LONG', size: 0.01, markPrice: 100000 }]);
    // Without gateSeverity, it's not a staged entry, so it gets rejected
    input.marketData.tradePlanContext!.gateSeverity = undefined as any;
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.approved).toBe(false);
    expect(risk.reason).toBe('PYRAMIDING_NOT_ALLOWED');
  });

  it("combined-risk cap ensures max exposure is bounded by 0.50% default risk", () => {
    const input = getBaseInput('LONG');
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.tradePlan?.stagedEntry?.combinedRiskLimitPct).toBe(0.005);
  });
});
