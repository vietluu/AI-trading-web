import { describe, expect, it } from "vitest";
import { evaluateRisk } from "../../src/modules/risk/domain/risk-engine";
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

const baseInput: RiskInput = {
  symbol: 'BTC-USDT',
  account: { balance: 10000, equity: 10000, peakEquity: 10000 },
  currentPositions: [],
  decision: {
    decision: 'LONG',
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
      gateSeverity: 'APPROVE', // This triggers probeSizePct = 0.25
      support: 98000,
      resistance: 104000,
      marketStructure: 'HH_HL',
      timeframeMs: 3600000,
      candleClose: 100000,
    },
  },
  now: new Date(),
};

describe("Staged Entry Risk Evaluation", () => {
  it("calculates probe order size based on 25% of combined risk", () => {
    const risk = evaluateRisk(baseInput, defaultLimits);
    expect(risk.approved).toBe(true);
    expect(risk.tradePlan?.stagedEntry).toBeDefined();
    expect(risk.tradePlan?.stagedEntry?.probeSizePct).toBe(0.25);

    // Full position size for $10,000 balance, 0.5% risk ($50)
    // Distance = 2000 + slippage = ~0.02
    // Asset size approx 0.025 BTC, so 25% is approx 0.00625
    expect(risk.positionSize).toBeGreaterThan(0.005);
    expect(risk.positionSize).toBeLessThan(0.007);
  });
});
