import { describe, expect, it } from "vitest";
import type { DecisionOutput } from "@platform/shared";
import { buildAdaptiveTradePlan } from "../../src/modules/risk/domain/trade-plan-engine";
import { buildExecutionContext } from "../../src/modules/pipeline/domain/execution-context";
import { createBaseSnapshot, createValidLongThesis } from "../helpers/thesis-fixture";

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
  it("rejects a proactive range-reversal thesis in the middle of its range", () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      setup: "RANGE_REVERSAL" as const,
      entryZone: { lower: 109_900, upper: 110_100 },
    };
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 110_000,
      decision: decision("LONG", "RANGING"),
      market: {
        atr: 1_000,
        support: 108_000,
        resistance: 112_000,
        proactive: { thesisId: "thesis-1", thesis, snapshot, mode: "DEMO", sizeFactor: 1 },
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan).toMatchObject({ approved: false, reason: "RANGE_MIDPOINT_ENTRY_BLOCKED" });
  });

  it("rejects a range-reversal thesis with degenerate range boundaries", () => {
    const snapshot = createBaseSnapshot();
    if (snapshot.structure.coverage === 'AVAILABLE') {
      snapshot.structure.rangeBoundaries = { lower: 112_000, upper: 108_000 };
    }
    const thesis = {
      ...createValidLongThesis(),
      setup: "RANGE_REVERSAL" as const,
      entryZone: { lower: 108_000, upper: 108_500 },
    };
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 108_200,
      decision: decision("LONG", "RANGING"),
      market: {
        atr: 1_000,
        support: 108_000,
        resistance: 112_000,
        proactive: { thesisId: "thesis-1", thesis, snapshot, mode: "DEMO", sizeFactor: 1 },
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan).toMatchObject({ approved: false, reason: "THESIS_RANGE_BOUNDARY_REQUIRED" });
  });

  it("rejects a range-reversal thesis when entry price is outside range boundaries", () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      setup: "RANGE_REVERSAL" as const,
      entryZone: { lower: 105_000, upper: 106_000 },
    };
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 105_500, // outside [108_000, 112_000]
      decision: decision("LONG", "RANGING"),
      market: {
        atr: 1_000,
        support: 108_000,
        resistance: 112_000,
        proactive: { thesisId: "thesis-1", thesis, snapshot, mode: "DEMO", sizeFactor: 1 },
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan).toMatchObject({ approved: false, reason: "THESIS_RANGE_DIRECTION_INVALID" });
  });

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
    expect(plan.stopLoss).toBe(97.75);
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
      breakEvenAtR: 0.8,
      trailingAtrMultiple: 1.8,
      structuralRiskAtr: 1.2,
    });
    expect(plan.stopLoss).toBe(99.4);
    expect(plan.rewardToRisk).toBeGreaterThanOrEqual(1.25);
  });

  it("rejects an exhausted momentum entry far above EMA20", () => {
    const scalpDecision = {
      ...decision("LONG", "TRENDING"),
      reasoning: "[momentum-scalp] Confirmed liquid impulse.",
    };
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 102,
      decision: scalpDecision,
      market: { atr: 1, ema20: 100, rsi: 76, timeframeMs: 5 * 60_000 },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan).toMatchObject({
      approved: false,
      reason: "MOMENTUM_ENTRY_OVEREXTENDED",
      strategy: "MOMENTUM_SCALP",
    });
  });

  it("rejects a breakout entry that has already run too far past its level", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 103,
      decision: decision("LONG", "TRENDING"),
      market: { atr: 1, resistance: 102, breakout: true, marketStructure: "HH_HL" },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan).toMatchObject({
      approved: false,
      reason: "BREAKOUT_ENTRY_OVEREXTENDED",
      strategy: "BREAKOUT_RETEST",
    });
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
      takeProfit: 103.2,
    });
  });

  it("rejects overextended trend entries when price is too far from EMA20", () => {
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 110,
      decision: decision("LONG", "TRENDING"),
      market: {
        atr: 1.5,
        ema20: 100,
        ema50: 95,
        adx: 30,
        efficiencyRatio: 0.6,
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan).toMatchObject({
      approved: false,
      reason: "PRICE_EXTENDED_FROM_EMA20",
    });
  });

  it("permits momentum scalps with high RSI in strong trending regime and scales trailing ATR for long tail", () => {
    const btcPlan = buildAdaptiveTradePlan({
      symbol: "BTC-USDT",
      side: "LONG",
      entryPrice: 100,
      decision: {
        ...decision("LONG", "TRENDING"),
        reasoning: "Strong volume [momentum-scalp] breakout",
      },
      market: {
        atr: 1,
        rsi: 78, // Above old static 72, but below trending dynamic max 85
        ema20: 99.5, // emaExtension = 0.5 < atr * 0.75
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 2.0,
    });

    // For BTC (MAJOR): maxRsiLong is 85, so 78 is not exhausted momentum; trailing ATR is 1.8 * 1 = 1.8
    expect(btcPlan.approved).toBe(true);
    expect(btcPlan.strategy).toBe("MOMENTUM_SCALP");
    expect(btcPlan.trailingAtrMultiple).toBe(1.8);

    const memePlan = buildAdaptiveTradePlan({
      symbol: "PEPE-USDT",
      side: "LONG",
      entryPrice: 100,
      decision: {
        ...decision("LONG", "TRENDING"),
        reasoning: "Strong volume [momentum-scalp] breakout",
      },
      market: {
        atr: 1,
        rsi: 78,
        ema20: 99.5,
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 2.0,
    });

    // For PEPE (LONG_TAIL): multiplier is 2.5, trailing ATR is 1.8 * 2.5 = 4.5
    expect(memePlan.approved).toBe(true);
    expect(memePlan.trailingAtrMultiple).toBe(4.5);
  });

  it("rejects LONG entry when volume climax shows exhaustion spike with heavy upper wick", () => {
    const plan = buildAdaptiveTradePlan({
      symbol: "BTC-USDT",
      side: "LONG",
      entryPrice: 100,
      decision: decision("LONG", "TRENDING"),
      market: {
        atr: 1,
        volumeRatio: 3.2, // > 2.5 Climax volume
        candleOpen: 97,
        candleHigh: 103, // Candle range = 6 (from 97 to 103)
        candleLow: 97,
        candleClose: 98, // Body = 1 (1/6 = 0.166 < 0.35), Upper wick = 103 - 98 = 5 (5/6 = 83% > 50%)
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 2.0,
    });

    expect(plan.approved).toBe(false);
    expect(plan.reason).toBe("VOLUME_EXHAUSTION_SPIKE");
  });

  it("detects liquidity sweep V-shape reversal and creates tight structural stop with limit entry", () => {
    const plan = buildAdaptiveTradePlan({
      symbol: "ETH-USDT",
      side: "LONG",
      entryPrice: 99,
      decision: decision("LONG", "TRENDING"),
      market: {
        atr: 1.5,
        support: 98,
        candleOpen: 100,
        candleHigh: 101,
        candleLow: 96, // Dips below support 98 (swept support)
        candleClose: 99.5, // Retracts back above support, lower wick = 99 - 96 = 3, range = 5 (60% wick + swept support)
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 2.0,
    });

    expect(plan.approved).toBe(true);
    expect(plan.strategy).toBe("LIQUIDITY_SWEEP_REVERSAL");
    expect(plan.isLiquiditySweep).toBe(true);
    expect(plan.orderType).toBe("LIMIT");
    expect(plan.limitEntryPrice).toBeDefined();
    expect(plan.limitEntryPrice).toBeLessThan(99);
    // Stop loss placed below sweep low (96 - 1.5*0.2 = 95.7)
    expect(plan.stopLoss).toBe(95.7);
  });

  it("provides limitEntryPrice and orderType LIMIT for trend pullback trades", () => {
    const plan = buildAdaptiveTradePlan({
      symbol: "BTC-USDT",
      side: "LONG",
      entryPrice: 100,
      decision: decision("LONG", "TRENDING"),
      market: {
        atr: 1,
        adx: 28,
        efficiencyRatio: 0.5,
        ema20: 98,
        ema50: 95,
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 2.0,
    });

    expect(plan.approved).toBe(true);
    expect(plan.strategy).toBe("TREND_PULLBACK");
    expect(plan.orderType).toBe("LIMIT");
    expect(plan.limitEntryPrice).toBeDefined();
    // LONG limit entry should be below market entry price
    expect(plan.limitEntryPrice).toBeLessThan(100);
    expect(plan.limitTtlCandles).toBe(2);
  });

  it("rejects trades where gross reward is too thin to overcome round-trip fee friction", () => {
    // In fallback mode without ATR, entryPrice 100, configuredStopLossPct 0.002 (risk = 0.2), configuredRR 1.0 -> targetDistance = 0.2
    // With roundTripCostPct 0.002 -> 2.5x cost = 0.5 > targetDistance (0.2) -> INSUFFICIENT_NET_EDGE_AFTER_FEES
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 100,
      decision: decision("LONG", "TRENDING"),
      market: {}, // No ATR -> uses fallback branch with approved = true
      configuredStopLossPct: 0.001,
      configuredRiskRewardRatio: 1.0,
      roundTripCostPct: 0.002,
    });

    expect(plan.approved).toBe(false);
    expect(plan.reason).toBe("INSUFFICIENT_NET_EDGE_AFTER_FEES");
  });

  it("calculates multi-stage take profit targets (tp1Price at mid-range, tp2Price at boundary)", () => {
    const plan = buildAdaptiveTradePlan({
      symbol: "SOL-USDT",
      side: "LONG",
      entryPrice: 100,
      decision: decision("LONG", "RANGING"),
      market: {
        atr: 1.0,
        support: 98,
        resistance: 105,
        timeframeMs: 15 * 60_000,
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 2.0,
      roundTripCostPct: 0.0004,
    });

    expect(plan.approved).toBe(true);
    expect(plan.orderType).toBe("LIMIT");
    expect(plan.tp1Price).toBeDefined();
    expect(plan.tp2Price).toBeDefined();
    // LONG tp1Price should be midway between entry (100) and full takeProfit
    expect(plan.tp1Price).toBeGreaterThan(100);
    expect(plan.tp1Price).toBeLessThan(plan.takeProfit!);
    expect(plan.tp2Price).toBe(plan.takeProfit);
    expect(plan.grossRewardPct).toBeGreaterThan(1.0);
    expect(plan.expectedNetRewardPct).toBeGreaterThan(0.5);
  });

  it("validates RECOVERY_RECLAIM setup without reclassifying it", () => {
    const snapshot = createBaseSnapshot();
    const thesis = {
      ...createValidLongThesis(),
      setup: "RECOVERY_RECLAIM" as const,
      entryZone: { lower: 109_500, upper: 110_500 },
      stopLoss: 109_000,
      targets: [{ price: 112_000, fraction: 1 }],
      expectedNetR: 1.5,
      trigger: [{ type: 'PRICE_CROSS' as const, operator: '>=' as const, price: 110_000, candleFinality: 'CLOSED' as const, description: 'Confirm recovery reclaim' }],
    };
    const plan = buildAdaptiveTradePlan({
      side: "LONG",
      entryPrice: 110_000,
      decision: decision("LONG", "TRENDING"),
      market: {
        atr: 1_000,
        support: 108_000,
        resistance: 115_000,
        proactive: { thesisId: "thesis-rec-1", thesis, snapshot, mode: "DEMO", sizeFactor: 1 },
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    });

    expect(plan.approved).toBe(true);
    expect(plan.strategy).toBe("RECOVERY_RECLAIM");
    expect(plan.targets).toEqual(thesis.targets);
    expect(plan.stagedEntry?.setup).toBe("RECOVERY_RECLAIM");
  });

  it("does not convert range reversal into trend pullback", () => {
    const rangeShortAtResistance = {
      side: "SHORT" as const,
      entryPrice: 1.0235,
      decision: decision("SHORT", "RANGING"),
      market: {
        atr: 0.00467606,
        support: 1.0151,
        resistance: 1.0245,
        // Bearish trend indicators that would ordinarily trigger quantitative trend
        adx: 35,
        efficiencyRatio: 0.45,
        ema20: 1.0200,
        ema50: 1.0220,
        executionContext: buildExecutionContext({
          regime: "RANGING",
          setup: "RANGE_REVERSION",
          action: "ENTER",
          price: 1.0235,
          support: 1.0151,
          resistance: 1.0245,
          atr: 0.00467606,
          sourceDataCutoff: new Date().toISOString(),
          primaryCandleClosed: true,
          triggerConfirmed: true,
        }),
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    };

    const plan = buildAdaptiveTradePlan(rangeShortAtResistance);
    expect(plan.regime).toBe("RANGING");
    expect(plan.strategy).toBe("RANGE_REVERSAL");
  });

  it("selects trade plan directly from executionContext setup and does not reclassify", () => {
    // When range boundary is violated for RANGE_REVERSION, reject as RANGE_REVERSAL rather than falling through to TREND_PULLBACK
    const invalidRangeShort = {
      side: "SHORT" as const,
      entryPrice: 1.0171, // near support, violates short boundary
      decision: decision("SHORT", "RANGING"),
      market: {
        atr: 0.00467606,
        support: 1.0151,
        resistance: 1.0245,
        adx: 35,
        efficiencyRatio: 0.45,
        ema20: 1.0200,
        ema50: 1.0220,
        executionContext: buildExecutionContext({
          regime: "RANGING",
          setup: "RANGE_REVERSION",
          action: "ENTER",
          price: 1.0171,
          support: 1.0151,
          resistance: 1.0245,
          atr: 0.00467606,
          sourceDataCutoff: new Date().toISOString(),
          primaryCandleClosed: true,
          triggerConfirmed: true,
        }),
      },
      configuredStopLossPct: 0.02,
      configuredRiskRewardRatio: 1.5,
    };

    const plan = buildAdaptiveTradePlan(invalidRangeShort);
    expect(plan.approved).toBe(false);
    expect(plan.regime).toBe("RANGING");
    expect(plan.strategy).toBe("RANGE_REVERSAL");
    expect(plan.reason).toBe("RANGE_ENTRY_NOT_AT_BOUNDARY");
  });
});

