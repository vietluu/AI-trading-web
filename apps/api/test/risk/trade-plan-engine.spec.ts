import { describe, expect, it } from "vitest";
import type { DecisionOutput } from "@platform/shared";
import { buildAdaptiveTradePlan } from "../../src/modules/risk/domain/trade-plan-engine";

const decision = (
  side: "LONG" | "SHORT",
  regime: "TRENDING" | "RANGING" | "HIGH_VOLATILITY",
): DecisionOutput => ({
  decision: side,
  confidence: 80,
  reasoning: "test",
  signals: { bullishFactors: [], bearishFactors: [] },
  risks: [],
  agreementScore: 80,
  dataQuality: "GOOD",
  regime: { type: regime },
  weighting: { market: 20, technical: 20, news: 15, sentiment: 15, macro: 15, onchain: 15 },
  overrides: [],
  volatilityAdjustment: 0,
  conflictLevel: "LOW",
  opportunityScore: 75,
  expectedWinProbability: 0.65,
  expectedReward: 1.8,
  expectedLoss: 0.8,
  expectedValue: 0.6,
  profitFactorEstimate: 1.8,
  riskScore: 30,
  adaptiveThreshold: 60,
  calibrationAdjustment: 0,
  executionCost: 0.05,
  generatedAt: new Date().toISOString(),
});

describe("adaptive trade plan engine", () => {
  it("places a ranging LONG target before resistance", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 98.6,
      decision: decision("LONG", "RANGING"),
      market: { atr: 0.5, support: 98, resistance: 102, marketStructure: "RANGE" },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan.approved).toBe(true);
    expect(plan.strategy).toBe("RANGE_REVERSAL");
    expect(plan.stopLoss).toBe(97.85);
    expect(plan.takeProfit).toBe(101.9);
  });

  it("rejects entries in the middle of a range", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 100,
      decision: decision("LONG", "RANGING"),
      market: { atr: 0.5, support: 98, resistance: 102, marketStructure: "RANGE" },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan).toMatchObject({
      approved: false,
      reason: "RANGE_ENTRY_NOT_AT_BOUNDARY",
    });
  });

  it.each([
    ["5m", 5 * 60_000, 8],
    ["15m", 15 * 60_000, 8],
    ["1h", 60 * 60_000, 2],
    ["4h", 4 * 60 * 60_000, 1],
  ])("caps %s range holding time at roughly two hours", (_label, timeframeMs, expectedCandles) => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 98.6,
      decision: decision("LONG", "RANGING"),
      market: { atr: 0.5, support: 98, resistance: 102, marketStructure: "RANGE", timeframeMs },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });
    expect(plan.approved).toBe(true);
    expect(plan.maxHoldingCandles).toBe(expectedCandles);
  });

  it("uses an ATR tolerance near a range boundary but still enforces net risk/reward", () => {
    const plan = buildAdaptiveTradePlan({
      side: "SHORT",
      entryPrice: 0.1968,
      decision: decision("SHORT", "RANGING"),
      market: {
        atr: 0.00097142,
        support: 0.1949,
        resistance: 0.1979,
        marketStructure: "RANGE",
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan.reason).not.toBe("RANGE_ENTRY_NOT_AT_BOUNDARY");
    expect(plan).toMatchObject({
      approved: false,
      reason: "STRUCTURAL_RISK_REWARD_NOT_MET",
    });
    expect(typeof plan.entryLocation).toBe("number");
    expect(typeof plan.boundaryThreshold).toBe("number");
  });

  it("rejects a trend setup whose structural stop is too wide", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 100,
      decision: decision("LONG", "TRENDING"),
      market: { atr: 1, support: 95, resistance: 108, marketStructure: "HH_HL" },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan).toMatchObject({
      approved: false,
      reason: "STRUCTURAL_STOP_TOO_WIDE",
    });
  });

  it("uses a nearby trend EMA instead of a distant rolling-range extreme", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 100,
      decision: decision("LONG", "TRENDING"),
      market: {
        atr: 1,
        support: 94,
        resistance: 108,
        ema20: 99.2,
        ema50: 97,
        adx: 30,
        efficiencyRatio: 0.5,
        marketStructure: "HH_HL",
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan.approved).toBe(true);
    expect(plan.strategy).toBe("TREND_PULLBACK");
    expect(plan.structuralRiskAtr).toBeLessThan(2);
  });

  it("reclassifies the observed BTC setup by its real risk/reward instead of distant support", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 64_986.3,
      decision: decision("LONG", "RANGING"),
      market: {
        atr: 119.258341,
        support: 64_229.4,
        resistance: 65_087.4,
        ema20: 64_710.98477336,
        ema50: 64_548.28011301,
        adx: 29.58,
        efficiencyRatio: 0.5459,
        marketStructure: "HH_HL",
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan.reason).not.toBe("STRUCTURAL_STOP_TOO_WIDE");
    expect(plan).toMatchObject({
      approved: false,
      reason: "STRUCTURAL_RISK_REWARD_NOT_MET",
      strategy: "TREND_PULLBACK",
    });
  });

  it("derives a buffered breakout when the AI omits the optional breakout flag", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 102.2,
      decision: decision("LONG", "TRENDING"),
      market: { atr: 1, resistance: 102, marketStructure: "HH_HL" },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan.strategy).toBe("BREAKOUT_RETEST");
  });

  it("builds a short-lived cost-aware plan for momentum scalp", () => {
    const scalpDecision = {
      ...decision("LONG", "TRENDING"),
      reasoning: "[momentum-scalp] Confirmed liquid impulse.",
    };
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 100,
      decision: scalpDecision,
      market: { atr: 0.5, timeframeMs: 5 * 60_000 },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });
    expect(plan).toMatchObject({
      approved: true,
      strategy: "MOMENTUM_SCALP",
      maxHoldingCandles: 6,
      breakEvenAtR: 0.7,
      trailingAtrMultiple: 1.5,
    });
    expect(plan.rewardToRisk).toBeGreaterThanOrEqual(1.25);
  });

  it("uses quantitative trend evidence even when the AI regime says ranging", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 100,
      decision: decision("LONG", "RANGING"),
      market: {
        atr: 1,
        support: 99,
        resistance: 106,
        adx: 28,
        efficiencyRatio: 0.55,
        ema20: 101,
        ema50: 99,
        marketStructure: "RANGE",
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan.approved).toBe(true);
    expect(plan.regime).toBe("TREND_UP");
    expect(plan.strategy).toBe("TREND_PULLBACK");
  });

  it("uses breakout levels and an ATR trailing plan", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 102.4,
      decision: decision("LONG", "TRENDING"),
      market: { atr: 1, resistance: 102, breakout: true, marketStructure: "HH_HL" },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan.approved).toBe(true);
    expect(plan.strategy).toBe("BREAKOUT_RETEST");
    expect(plan.takeProfit).toBeGreaterThan(102.4);
    expect(plan.trailingAtrMultiple).toBe(2.5);
  });

  it("keeps the legacy fixed-risk fallback when ATR is unavailable", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 100,
      decision: decision("LONG", "TRENDING"),
      market: {},
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan).toMatchObject({
      approved: true,
      strategy: "LEGACY_FALLBACK",
      stopLoss: 98,
      takeProfit: 103,
    });
  });
});
