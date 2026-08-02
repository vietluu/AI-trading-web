import type { DecisionOutput, FusionInput } from "@platform/shared";
import { describe, expect, it } from "vitest";
import { decisionForStrategy } from "../../src/modules/portfolio/domain/strategy-decision";

const base = {
  decision: "LONG",
  confidence: 75,
  reasoning: "Shared decision context.",
  signals: { bullishFactors: [], bearishFactors: [] },
  risks: [],
  agreementScore: 75,
  dataQuality: "GOOD",
  regime: { type: "TRENDING", confidence: 80 },
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
});
