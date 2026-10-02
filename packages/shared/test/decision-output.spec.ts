import { describe, expect, it } from "vitest";
import { DecisionOutputSchema } from "../src/schemas/agents";

const validDecision = {
  decision: "LONG" as const,
  confidence: 80,
  reasoning: "Exact cohort supports the bounded thesis",
  signals: { bullishFactors: ["trend"], bearishFactors: [] },
  risks: [],
  agreementScore: 80,
  dataQuality: "GOOD" as const,
  regime: { type: "TRENDING" as const },
  weighting: {
    technical: 30,
    market: 20,
    sentiment: 15,
    news: 15,
    macro: 10,
    onchain: 10,
  },
  overrides: [],
  volatilityAdjustment: 0,
  conflictLevel: "LOW" as const,
  opportunityScore: 75,
  expectedWinProbability: 0.6,
  expectedReward: 2,
  expectedLoss: 1,
  expectedValue: 0.8,
  profitFactorEstimate: 3,
  riskScore: 25,
  adaptiveThreshold: 60,
  calibrationAdjustment: 0,
  executionCost: 0,
  generatedAt: "2026-10-01T00:00:00.000Z",
};

describe("DecisionOutput economics authority", () => {
  it("accepts exact lifecycle probability provenance", () => {
    const parsed = DecisionOutputSchema.parse({
      ...validDecision,
      economicsAuthority: {
        probabilityAuthority: "EXACT_LIFECYCLE",
        lifecycleAction: "FULL_SIZE",
        sampleSize: 30,
        empiricalWinProbability: 0.6,
      },
    });

    expect(parsed.economicsAuthority).toEqual({
      probabilityAuthority: "EXACT_LIFECYCLE",
      lifecycleAction: "FULL_SIZE",
      sampleSize: 30,
      empiricalWinProbability: 0.6,
    });
  });

  it("rejects a fabricated probability when authority is unavailable", () => {
    expect(() =>
      DecisionOutputSchema.parse({
        ...validDecision,
        economicsAuthority: {
          probabilityAuthority: "UNAVAILABLE",
          lifecycleAction: "PROBE_ONLY",
          sampleSize: 12,
          empiricalWinProbability: 0.5,
        },
      }),
    ).toThrow(/Unavailable probability authority requires a null probability/);
  });
});
