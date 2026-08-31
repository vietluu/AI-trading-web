import { describe, expect, it } from "vitest";
import {
  compareConfluenceSignals,
  computeConcordanceSizeFactor,
  computeMultiFactorCompositeScore,
  evaluateConfluence,
} from "../../src/modules/pipeline/domain/confluence-engine";
import type {
  ConfluenceSignal,
  ConfluenceSizeConfig,
} from "../../src/modules/pipeline/domain/confluence-engine.types";

function createMockSignal(overrides: Partial<ConfluenceSignal> = {}): ConfluenceSignal {
  return {
    pipelineRunId: "run-1",
    symbol: "BTC-USDT",
    decision: "SHORT",
    confidence: 80,
    opportunityScore: 75,
    expectedValue: 0.25,
    riskScore: 2.5,
    strategyKey: "trend",
    compositeScore: 65,
    regime: "TRENDING",
    referencePrice: 60000,
    executionContext: {
      executionDecision: { decision: "SHORT" },
      strategyKey: "trend",
      provider: "BINANCE",
    },
    ...overrides,
  };
}

describe("ConfluenceEngine Domain Logic", () => {
  describe("computeMultiFactorCompositeScore", () => {
    it("calculates weighted composite score combining confidence, opp, EV, and risk", () => {
      const score = computeMultiFactorCompositeScore({
        confidence: 80, // 80 * 0.40 = 32
        opportunityScore: 75, // 75 * 0.30 = 22.5
        expectedValue: 0.25, // 25 * 0.20 = 5
        riskScore: 20, // (100 - 20) * 0.10 = 8
      });
      // 32 + 22.5 + 5 + 8 = 67.5
      expect(score).toBe(67.5);
    });

    it("handles edge values cleanly", () => {
      const minScore = computeMultiFactorCompositeScore({
        confidence: 0,
        opportunityScore: 0,
        expectedValue: -1.0,
        riskScore: 100,
      });
      expect(minScore).toBeLessThanOrEqual(0);

      const maxScore = computeMultiFactorCompositeScore({
        confidence: 100,
        opportunityScore: 100,
        expectedValue: 1.0,
        riskScore: 0,
      });
      expect(maxScore).toBeGreaterThanOrEqual(80);
    });
  });

  describe("computeConcordanceSizeFactor", () => {
    const config: ConfluenceSizeConfig = {
      boostPerSignal: 0.25,
      maxSizeFactor: 2.0,
      minSignalsForBoost: 2,
    };

    it("returns 1.0 when concordance count is below threshold (1 signal)", () => {
      expect(computeConcordanceSizeFactor(1, config)).toBe(1.0);
    });

    it("returns 1.0 when concordance count is 0 or negative", () => {
      expect(computeConcordanceSizeFactor(0, config)).toBe(1.0);
      expect(computeConcordanceSizeFactor(-1, config)).toBe(1.0);
    });

    it("applies 1.25x boost for 2 concurrent signals", () => {
      expect(computeConcordanceSizeFactor(2, config)).toBe(1.25);
    });

    it("applies 1.50x boost for 3 concurrent signals", () => {
      expect(computeConcordanceSizeFactor(3, config)).toBe(1.5);
    });

    it("applies 1.75x boost for 4 concurrent signals", () => {
      expect(computeConcordanceSizeFactor(4, config)).toBe(1.75);
    });

    it("caps size factor at maxSizeFactor (2.0) for 5+ signals", () => {
      expect(computeConcordanceSizeFactor(5, config)).toBe(2.0);
      expect(computeConcordanceSizeFactor(10, config)).toBe(2.0);
    });

    it("applies quality bonus when selected signal has high opportunity score", () => {
      const configWithQuality: ConfluenceSizeConfig = {
        boostPerSignal: 0.25,
        maxSizeFactor: 2.0,
        minSignalsForBoost: 2,
        qualityBonus: {
          minOpportunityScore: 78,
          minExpectedValue: 0.3,
          bonusMultiplier: 0.1,
        },
      };

      // 2 signals (1.25) + 0.1 quality bonus = 1.35x
      const sizeFactor = computeConcordanceSizeFactor(2, configWithQuality, {
        opportunityScore: 80,
        expectedValue: 0.2,
      });
      expect(sizeFactor).toBe(1.35);
    });
  });

  describe("compareConfluenceSignals", () => {
    it("sorts primarily by composite score descending", () => {
      const a = createMockSignal({ symbol: "BTC-USDT", compositeScore: 80 });
      const b = createMockSignal({ symbol: "ETH-USDT", compositeScore: 90 });
      expect(compareConfluenceSignals(a, b)).toBeGreaterThan(0);
      expect(compareConfluenceSignals(b, a)).toBeLessThan(0);
    });

    it("breaks ties with confidence", () => {
      const a = createMockSignal({ symbol: "BTC-USDT", compositeScore: 80, confidence: 85 });
      const b = createMockSignal({ symbol: "ETH-USDT", compositeScore: 80, confidence: 75 });
      expect(compareConfluenceSignals(a, b)).toBeLessThan(0);
    });

    it("breaks ties with opportunityScore and expectedValue", () => {
      const a = createMockSignal({
        symbol: "BTC-USDT",
        compositeScore: 80,
        confidence: 80,
        opportunityScore: 90,
      });
      const b = createMockSignal({
        symbol: "ETH-USDT",
        compositeScore: 80,
        confidence: 80,
        opportunityScore: 70,
      });
      expect(compareConfluenceSignals(a, b)).toBeLessThan(0);
    });

    it("breaks final ties deterministically by symbol alphabetical order", () => {
      const a = createMockSignal({
        symbol: "BNB-USDT",
        compositeScore: 80,
        confidence: 80,
        opportunityScore: 80,
        expectedValue: 0.5,
      });
      const b = createMockSignal({
        symbol: "SOL-USDT",
        compositeScore: 80,
        confidence: 80,
        opportunityScore: 80,
        expectedValue: 0.5,
      });
      expect(compareConfluenceSignals(a, b)).toBeLessThan(0);
    });
  });

  describe("evaluateConfluence", () => {
    it("returns null for empty signals array", () => {
      expect(evaluateConfluence([], 3)).toBeNull();
    });

    it("selects top candidate and boosts size when 3 SHORT signals fire simultaneously (e.g. BTC, BNB, SOL)", () => {
      const btc = createMockSignal({
        pipelineRunId: "run-btc",
        symbol: "BTC-USDT",
        decision: "SHORT",
        compositeScore: 78.5,
        confidence: 82,
        opportunityScore: 75,
        expectedValue: 0.2,
      });
      const bnb = createMockSignal({
        pipelineRunId: "run-bnb",
        symbol: "BNB-USDT",
        decision: "SHORT",
        compositeScore: 68.0,
        confidence: 70,
      });
      const sol = createMockSignal({
        pipelineRunId: "run-sol",
        symbol: "SOL-USDT",
        decision: "SHORT",
        compositeScore: 74.2,
        confidence: 77,
      });

      const evaluation = evaluateConfluence([bnb, btc, sol], 3);
      expect(evaluation).not.toBeNull();
      expect(evaluation?.direction).toBe("SHORT");
      expect(evaluation?.selected.symbol).toBe("BTC-USDT");
      expect(evaluation?.selected.pipelineRunId).toBe("run-btc");
      expect(evaluation?.concordanceCount).toBe(3);
      expect(evaluation?.concordanceRatio).toBe(1.0);
      expect(evaluation?.sizeFactor).toBe(1.5);
      expect(evaluation?.rejected.map((s) => s.symbol)).toEqual(["SOL-USDT", "BNB-USDT"]);
    });

    it("handles single actionable signal correctly without boost", () => {
      const eth = createMockSignal({
        symbol: "ETH-USDT",
        decision: "LONG",
        compositeScore: 60,
      });

      const evaluation = evaluateConfluence([eth], 3);
      expect(evaluation).not.toBeNull();
      expect(evaluation?.direction).toBe("LONG");
      expect(evaluation?.selected.symbol).toBe("ETH-USDT");
      expect(evaluation?.concordanceCount).toBe(1);
      expect(evaluation?.concordanceRatio).toBeCloseTo(0.333, 2);
      expect(evaluation?.sizeFactor).toBe(1.0);
      expect(evaluation?.rejected).toHaveLength(0);
    });

    it("handles mixed directions by prioritizing the dominant majority direction", () => {
      const btcShort = createMockSignal({
        symbol: "BTC-USDT",
        decision: "SHORT",
        compositeScore: 75,
        opportunityScore: 70,
        expectedValue: 0.1,
      });
      const ethShort = createMockSignal({
        symbol: "ETH-USDT",
        decision: "SHORT",
        compositeScore: 70,
      });
      const solLong = createMockSignal({
        symbol: "SOL-USDT",
        decision: "LONG",
        compositeScore: 80,
      });

      const evaluation = evaluateConfluence([btcShort, ethShort, solLong], 3);
      expect(evaluation).not.toBeNull();
      expect(evaluation?.direction).toBe("SHORT");
      expect(evaluation?.selected.symbol).toBe("BTC-USDT");
      expect(evaluation?.concordanceCount).toBe(2);
      expect(evaluation?.sizeFactor).toBe(1.25);
      expect(evaluation?.rejected.map((s) => s.symbol)).toContain("ETH-USDT");
      expect(evaluation?.rejected.map((s) => s.symbol)).toContain("SOL-USDT");
    });
  });
});
