import type { DecisionOutput, FusionInput } from "@platform/shared";
import { describe, expect, it } from "vitest";
import {
  analysisParams,
  decisionForStrategy,
  selectStrategyDecision,
} from "../../src/modules/portfolio/domain/strategy-decision";

const base = {
  decision: "LONG",
  confidence: 75,
  reasoning: "Shared decision context.",
  signals: { bullishFactors: [], bearishFactors: [] },
  risks: [],
  agreementScore: 75,
  dataQuality: "GOOD",
  regime: { type: "TRENDING" },
  weighting: {
    market: 20,
    technical: 30,
    news: 10,
    sentiment: 15,
    macro: 15,
    onchain: 10,
  },
  overrides: [],
  volatilityAdjustment: 0,
  conflictLevel: "LOW",
  opportunityScore: 70,
  expectedWinProbability: 0.7,
  expectedReward: 1.5,
  expectedLoss: 0.8,
  expectedValue: 0.6,
  profitFactorEstimate: 1.9,
  riskScore: 35,
  adaptiveThreshold: 60,
  calibrationAdjustment: 0,
  executionCost: 0.04,
  generatedAt: new Date().toISOString(),
} as DecisionOutput;

const analyses = {
  market: {
    trend: { direction: "UP", strength: "STRONG" },
    volatility: { level: "LOW" },
  },
  technical: {
    trend: { direction: "UP", strength: "STRONG" },
    momentum: { rsiState: "OVERSOLD" },
    structure: { breakout: true },
  },
  news: { impact: { level: "HIGH", direction: "NEGATIVE" } },
} as FusionInput;

describe("independent strategy decisions", () => {
  it("only forwards supported analyst fields to strict validation", () => {
    expect(
      analysisParams({
        strategyId: "trend",
        strategyIds: ["trend", "news"],
        eventScan: { fingerprint: "zro-5m-bullish" },
        futureRoutingMetadata: true,
        interval: "15m",
        maxItems: 50,
      }),
    ).toEqual({ interval: "15m", maxItems: 50 });
  });

  it.each([
    ["ai-core", "LONG", 75],
    ["trend", "LONG", 80],
    ["breakout", "LONG", 74],
    ["news", "SHORT", 82],
  ])("evaluates %s with its own policy", (key, decision, confidence) => {
    expect(decisionForStrategy(key, base, analyses)).toMatchObject({
      decision,
      confidence,
    });
  });

  it("waits when a rule-based strategy has no setup", () => {
    const noSetup = {
      ...analyses,
      technical: {
        ...analyses.technical,
        trend: { direction: "SIDEWAYS", strength: "WEAK" },
        momentum: { rsiState: "NEUTRAL" },
        structure: { breakout: false },
      },
    } as FusionInput;
    expect(decisionForStrategy("breakout", base, noSetup).decision).toBe(
      "WAIT",
    );
    expect(decisionForStrategy("mean-reversion", base, noSetup).decision).toBe(
      "WAIT",
    );
  });

  it("activates momentum scalp only for a liquid confirmed short-horizon impulse", () => {
    const result = decisionForStrategy("momentum-scalp", base, analyses, {
      timeframe: "5m",
      priceChangePercent: 0.45,
      volumeChangePercent: 1.2,
      adx: 24,
      efficiencyRatio: 0.36,
      ema20: 101,
      ema50: 100,
    });
    expect(result).toMatchObject({
      decision: "LONG",
      adaptiveThreshold: 60,
      opportunityScore: 70,
    });
    expect(result.reasoning).toContain("[momentum-scalp]");
  });

  it("does not chase an overextended momentum move", () => {
    expect(decisionForStrategy("momentum-scalp", base, analyses, {
      timeframe: "5m",
      priceChangePercent: 3.2,
      volumeChangePercent: 5,
      adx: 35,
      efficiencyRatio: 0.6,
      ema20: 101,
      ema50: 100,
    }).decision).toBe("WAIT");
  });

  it("uses a bounded range threshold for an active mean-reversion setup", () => {
    const strictRangeBase = {
      ...base,
      regime: { type: "RANGING" as const },
      adaptiveThreshold: 84,
    };

    expect(decisionForStrategy("mean-reversion", strictRangeBase, rangeAnalyses())).toMatchObject({
      decision: "LONG",
      confidence: 73,
      adaptiveThreshold: 62,
      opportunityScore: 70,
    });
  });

  it("rejects mean reversion away from a confirmed range boundary", () => {
    const middleOfRange = {
      ...rangeAnalyses(),
      technical: {
        ...rangeAnalyses().technical,
        volatility: { bollinger: { position: "MIDDLE" as const, squeeze: false } },
      },
    } as FusionInput;
    const rangingBase = {
      ...base,
      regime: { type: "RANGING" as const },
    };

    expect(decisionForStrategy("mean-reversion", rangingBase, middleOfRange).decision).toBe("WAIT");
  });

  it("recalculates economics for an active range reversal", () => {
    const rangingBase = {
      ...base,
      decision: "WAIT" as const,
      confidence: 0,
      regime: { type: "RANGING" as const },
      opportunityScore: 55,
      expectedValue: -0.5,
      adaptiveThreshold: 78,
    };

    const result = decisionForStrategy("mean-reversion", rangingBase, rangeAnalyses());
    expect(result.decision).toBe("LONG");
    expect(result.opportunityScore).toBe(68);
    expect(result.expectedValue).toBeGreaterThan(0);
    expect(result.expectedWinProbability).toBe(0.5);
  });

  it("cannot recreate confidence above the partial-data ceiling", () => {
    const partial = { ...base, dataQuality: "PARTIAL" as const };
    const result = decisionForStrategy("trend", partial, analyses);
    expect(result.confidence).toBe(75);
    expect(result.confidenceCalibration).toBeUndefined();
  });

  it("cannot inflate partial-data confidence or analyst agreement above consensus", () => {
    const partial = {
      ...base,
      decision: "WAIT" as const,
      confidence: 48,
      agreementScore: 40,
      dataQuality: "PARTIAL" as const,
    };
    const neutralRsi = {
      ...analyses,
      technical: {
        ...analyses.technical,
        momentum: { ...analyses.technical.momentum, rsiState: "NEUTRAL" as const },
      },
    } as FusionInput;

    expect(decisionForStrategy("trend", partial, neutralRsi)).toMatchObject({
      decision: "LONG",
      confidence: 48,
      agreementScore: 40,
    });
  });

  it("blocks trend and breakout entries that chase an exhausted move", () => {
    const bearishOversold = {
      ...analyses,
      market: {
        ...analyses.market,
        trend: { direction: "DOWN" as const, strength: "STRONG" as const },
      },
      technical: {
        ...analyses.technical,
        trend: { direction: "DOWN" as const, strength: "STRONG" as const },
        momentum: { ...analyses.technical.momentum, rsiState: "OVERSOLD" as const },
      },
    } as FusionInput;

    expect(decisionForStrategy("trend", base, bearishOversold).decision).toBe("WAIT");
    expect(decisionForStrategy("breakout", base, bearishOversold).decision).toBe("WAIT");
  });

  it("selects one regime-compatible strategy from a shared ranging snapshot", () => {
    const rangingBase = {
      ...base,
      regime: { type: "RANGING" as const },
      adaptiveThreshold: 78,
    };

    const selection = selectStrategyDecision(
      ["ai-core", "trend", "mean-reversion", "breakout", "news"],
      rangingBase,
      rangeAnalyses(),
    );

    expect(selection.selectedStrategyKey).toBe("mean-reversion");
    expect(selection.decision.decision).toBe("LONG");
    expect(selection.candidates).toHaveLength(5);
  });

  it("permits high-momentum breakout and trend entries when RSI is elevated (68-74) but not exhausted", () => {
    const highMomentumBreakout = {
      ...analyses,
      market: {
        ...analyses.market,
        trend: { direction: "UP" as const, strength: "STRONG" as const },
        volatility: { level: "HIGH" as const },
      },
      technical: {
        ...analyses.technical,
        trend: { direction: "UP" as const, strength: "STRONG" as const },
        momentum: {
          rsi: "71.5",
          rsiState: "OVERBOUGHT" as const,
          macd: { trend: "BULLISH" as const },
        },
        structure: { marketStructure: "HH_HL" as const, breakout: true },
      },
    } as FusionInput;

    expect(decisionForStrategy("ai-core", base, highMomentumBreakout).decision).toBe("LONG");
    expect(decisionForStrategy("trend", base, highMomentumBreakout).decision).toBe("LONG");
    expect(decisionForStrategy("breakout", base, highMomentumBreakout).decision).toBe("LONG");
  });

  it("blocks entries when RSI exceeds the upper boundary (>75) declaring true exhaustion", () => {
    const exhaustedMove = {
      ...analyses,
      market: {
        ...analyses.market,
        trend: { direction: "UP" as const, strength: "STRONG" as const },
      },
      technical: {
        ...analyses.technical,
        trend: { direction: "UP" as const, strength: "STRONG" as const },
        momentum: {
          rsi: "82.0",
          rsiState: "OVERBOUGHT" as const,
          macd: { trend: "BULLISH" as const },
        },
        structure: { marketStructure: "HH_HL" as const, breakout: true },
      },
    } as FusionInput;

    expect(decisionForStrategy("ai-core", base, exhaustedMove).decision).toBe("WAIT");
    expect(decisionForStrategy("trend", base, exhaustedMove).decision).toBe("WAIT");
    expect(decisionForStrategy("breakout", base, exhaustedMove).decision).toBe("WAIT");
  });

  it("deduplicates configured strategies and falls back safely", () => {
    expect(selectStrategyDecision(["trend", "trend"], base, analyses).candidates).toHaveLength(1);
    expect(selectStrategyDecision(["unknown"], base, analyses).selectedStrategyKey).toBe("ai-core");
  });
});

function rangeAnalyses(): FusionInput {
  return {
    ...analyses,
    market: {
      ...analyses.market,
      trend: { direction: "SIDEWAYS", strength: "WEAK" },
      volatility: { level: "LOW" },
    },
    technical: {
      ...analyses.technical,
      trend: { direction: "SIDEWAYS", strength: "WEAK" },
      momentum: {
        ...analyses.technical.momentum,
        rsiState: "OVERSOLD",
        macd: { trend: "BULLISH" },
      },
      volatility: { bollinger: { position: "LOWER", squeeze: false } },
      structure: { marketStructure: "RANGE", breakout: false },
      divergence: {},
    },
  };
}
