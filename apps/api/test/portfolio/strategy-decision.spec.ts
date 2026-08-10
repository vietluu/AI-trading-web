import type { DecisionOutput, FusionInput } from "@platform/shared";
import { describe, expect, it } from "vitest";
import {
  analysisParams,
  decisionForStrategy,
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
  it("removes portfolio routing fields before strict analyst validation", () => {
    expect(
      analysisParams({ strategyId: "trend", interval: "15m", maxItems: 50 }),
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
    expect(result.expectedWinProbability).toBeGreaterThan(0.6);
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
