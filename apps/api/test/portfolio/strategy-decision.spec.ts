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
    ["mean-reversion", "LONG", 70],
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

    expect(decisionForStrategy("mean-reversion", strictRangeBase, analyses)).toMatchObject({
      decision: "LONG",
      confidence: 70,
      adaptiveThreshold: 62,
    });
  });
});
