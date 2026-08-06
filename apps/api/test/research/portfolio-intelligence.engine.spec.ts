import { describe, expect, it } from "vitest";
import { analyzePortfolioIntelligence } from "../../src/modules/research/domain/portfolio-intelligence.engine";

describe("analyzePortfolioIntelligence", () => {
  it("uses real strategy allocation snapshots when available", () => {
    const result = analyzePortfolioIntelligence([
      {
        key: "ai-core",
        name: "AI Core",
        allocation: { weight: 0.5, allocatedCapital: 50000 },
        performance: { returnPct: 0.12, drawdownPct: 0.03, winRate: 0.6 },
      },
      {
        key: "trend",
        name: "Trend Following",
        allocation: { weight: 0.3, allocatedCapital: 30000 },
        performance: { returnPct: 0.08, drawdownPct: 0.06, winRate: 0.55 },
      },
      {
        key: "mean-reversion",
        name: "Mean Reversion",
        allocation: { weight: 0.2, allocatedCapital: 20000 },
        performance: { returnPct: 0.09, drawdownPct: 0.02, winRate: 0.63 },
      },
    ]);

    const firstAllocation = result.allocations[0];
    expect(firstAllocation).toBeDefined();
    if (!firstAllocation) {
      throw new Error("Expected at least one allocation");
    }
    expect(firstAllocation).toMatchObject({
      strategyKey: "ai-core",
      currentCapitalAllocationPct: 50,
    });
    expect(firstAllocation.recommendedCapitalAllocationPct).toBeGreaterThan(0);
    expect(firstAllocation.recommendedCapitalAllocationPct).toBeLessThanOrEqual(100);
    const secondAllocation = result.allocations[1];
    expect(secondAllocation).toBeDefined();
    if (secondAllocation) {
      expect(secondAllocation.recommendedCapitalAllocationPct).toBeLessThanOrEqual(100);
    }
    const totalRecommended = result.allocations.reduce(
      (sum, item) => sum + item.recommendedCapitalAllocationPct,
      0,
    );
    expect(totalRecommended).toBeCloseTo(100, 0);
  });

  it("adjusts recommendations using live positions and regime context", () => {
    const trendResult = analyzePortfolioIntelligence([
      {
        key: "ai-core",
        name: "AI Core",
        allocation: { weight: 0.5, allocatedCapital: 50000 },
        performance: { returnPct: 0.12, drawdownPct: 0.03, winRate: 0.6 },
        livePerformance: { unrealizedPnl: 1800, realizedPnl: 400, positionCount: 3 },
        marketRegime: "TRENDING",
      },
    ]);

    const volatileResult = analyzePortfolioIntelligence([
      {
        key: "ai-core",
        name: "AI Core",
        allocation: { weight: 0.5, allocatedCapital: 50000 },
        performance: { returnPct: 0.12, drawdownPct: 0.03, winRate: 0.6 },
        livePerformance: { unrealizedPnl: 1800, realizedPnl: 400, positionCount: 3 },
        marketRegime: "HIGH_VOLATILITY",
      },
    ]);

    const volatileAllocation = volatileResult.allocations[0];
    const trendAllocation = trendResult.allocations[0];
    expect(volatileAllocation).toBeDefined();
    expect(trendAllocation).toBeDefined();
    if (!volatileAllocation || !trendAllocation) {
      throw new Error("Expected allocations to be present");
    }
    expect(volatileAllocation.recommendedCapitalAllocationPct).toBeLessThan(
      trendAllocation.recommendedCapitalAllocationPct,
    );
  });
});
