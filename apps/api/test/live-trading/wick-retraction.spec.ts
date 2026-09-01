import { describe, expect, it } from "vitest";
import { evaluatePositionManagement } from "../../src/modules/live-trading/domain/position-manager";
import { buildAdaptiveTradePlan } from "../../src/modules/risk/domain/trade-plan-engine";

describe("Wick Retraction and Limitless Trailing", () => {
  it("should return wickRetractionClose = true when price drops >35% from a peak >1.5R", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 100,
      decision: {
        action: "LONG",
        confidence: 80,
        reasoning: "Test",
        regime: { type: "TREND_UP", strength: 80 }
      } as any,
      market: { atr: 1, timeframeMs: 60000, ema20: 99 },
      configuredStopLossPct: 1,
      configuredRiskRewardRatio: 2,
    });
    
    // Risk = 100 - 99 = 1. Peak = 102 (2R). Current = 100.5 (0.5R). Retained = 0.5/2 = 25% < 65%
    const result = evaluatePositionManagement({
      side: "LONG",
      entryPrice: 100,
      markPrice: 100.5,
      highestMark: 102,
      initialStopLoss: 99,
      currentStopLoss: 99,
      openedAt: new Date(),
      partialTaken: false,
      plan
    });

    expect(result.peakR).toBeCloseTo(2);
    expect(result.currentR).toBeCloseTo(0.5);
    expect(result.wickRetractionClose).toBe(true);
  });

  it("should NOT return wickRetractionClose if peak < 1.5R", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 100,
      decision: {
        action: "LONG",
        confidence: 80,
        reasoning: "Test",
        regime: { type: "TREND_UP", strength: 80 }
      } as any,
      market: { atr: 1, timeframeMs: 60000, ema20: 99 },
      configuredStopLossPct: 1,
      configuredRiskRewardRatio: 2,
    });
    
    // Risk = 1. Peak = 101.4 (1.4R). Current = 100.5 (0.5R). Retained < 65%
    const result = evaluatePositionManagement({
      side: "LONG",
      entryPrice: 100,
      markPrice: 100.5,
      highestMark: 101.4,
      initialStopLoss: 99,
      currentStopLoss: 99,
      openedAt: new Date(),
      partialTaken: false,
      plan
    });

    expect(result.peakR).toBeCloseTo(1.4);
    expect(result.wickRetractionClose).toBe(false);
  });

  it("should set takeProfit to Infinity if useLimitlessTrailing is true", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 100,
      decision: {
        action: "LONG",
        confidence: 80,
        reasoning: "Test",
        regime: { type: "TREND_UP", strength: 80 }
      } as any,
      market: { atr: 1, timeframeMs: 60000, ema20: 99 },
      configuredStopLossPct: 1,
      configuredRiskRewardRatio: 2,
      useLimitlessTrailing: true
    });
    
    expect(plan.takeProfit).toBe(undefined);
  });
});
