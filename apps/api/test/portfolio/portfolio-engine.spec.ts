import { describe, expect, it } from "vitest";
import {
  aggregatePositions,
  assessPortfolioRisk,
  calculateAllocations,
  shouldDisableStrategy,
  type PortfolioLimits,
  type StrategySnapshot,
} from "../../src/modules/portfolio/domain/portfolio-engine";

const limits: PortfolioLimits = {
  maxStrategies: 5,
  maxTotalExposure: 0.6,
  maxStrategyExposure: 0.25,
  maxDrawdown: 0.2,
  disableMinTrades: 10,
  disableReturnPct: -0.1,
  disableWinRate: 0.35,
};

const strategy = (
  id: string,
  overrides: Partial<StrategySnapshot["performance"]> = {},
): StrategySnapshot => ({
  id,
  key: id,
  status: "ACTIVE",
  performance: {
    totalTrades: 20,
    winRate: 0.5,
    returnPct: 0,
    drawdownPct: 0.05,
    sharpeRatio: 1,
    ...overrides,
  },
});

describe("Phase 10 portfolio engine", () => {
  it("runs up to five independent strategies and increases strong strategy allocation", () => {
    const allocations = calculateAllocations(
      [
        strategy("ai", { returnPct: 0.25, sharpeRatio: 2 }),
        strategy("trend", { returnPct: 0.1 }),
        strategy("mean"),
        strategy("breakout", { drawdownPct: 0.12 }),
        strategy("news", { returnPct: 0.05 }),
        strategy("ignored", { returnPct: 1 }),
      ],
      100_000,
      limits,
    );
    expect(allocations).toHaveLength(5);
    expect(allocations.find((item) => item.strategyId === "ai")?.weight).toBe(
      0.25,
    );
    expect(
      allocations.find((item) => item.strategyId === "ai")!.weight,
    ).toBeGreaterThan(
      allocations.find((item) => item.strategyId === "breakout")!.weight,
    );
    expect(allocations.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(
      1,
      5,
    );
    expect(allocations.every((item) => item.weight <= 0.25)).toBe(true);
  });

  it("disables a persistently losing or over-drawn strategy", () => {
    expect(
      shouldDisableStrategy(
        { totalTrades: 12, winRate: 0.2, returnPct: -0.15, drawdownPct: 0.1 },
        limits,
      ),
    ).toBe(true);
    const [allocation] = calculateAllocations(
      [strategy("loser", { winRate: 0.2, returnPct: -0.15 })],
      10_000,
      limits,
    );
    expect(allocation).toMatchObject({
      disabled: true,
      weight: 0,
      allocatedCapital: 0,
    });
  });

  it("caps a trade at both its allocation and the global portfolio limit", () => {
    const result = assessPortfolioRisk(
      {
        strategyId: "trend",
        symbol: "ETH-USDT",
        side: "LONG",
        requestedNotional: 40_000,
        equity: 100_000,
        peakEquity: 100_000,
        allocatedCapital: 25_000,
        positions: [
          {
            strategyId: "ai",
            symbol: "BTC-USDT",
            side: "LONG",
            quantity: 0.35,
            markPrice: 100_000,
          },
        ],
      },
      limits,
    );
    expect(result.approved).toBe(true);
    expect(result.approvedNotional).toBe(25_000);
    expect(result.totalExposurePct).toBe(0.6);
    expect(result.strategyExposurePct).toBe(0.25);
  });

  it("rejects correlated same-symbol direction across strategies", () => {
    const result = assessPortfolioRisk(
      {
        strategyId: "trend",
        symbol: "BTC-USDT",
        side: "LONG",
        requestedNotional: 10_000,
        equity: 100_000,
        peakEquity: 100_000,
        allocatedCapital: 25_000,
        positions: [
          {
            strategyId: "ai",
            symbol: "BTC-USDT",
            side: "LONG",
            quantity: 0.1,
            markPrice: 100_000,
          },
        ],
      },
      limits,
    );
    expect(result).toMatchObject({
      approved: false,
      reason: "CORRELATED_DIRECTION_LIMIT",
      correlatedStrategies: 1,
    });
  });

  it("activates the portfolio failsafe at maximum drawdown", () => {
    const result = assessPortfolioRisk(
      {
        strategyId: "ai",
        symbol: "BTC-USDT",
        side: "SHORT",
        requestedNotional: 1_000,
        equity: 80_000,
        peakEquity: 100_000,
        allocatedCapital: 20_000,
        positions: [],
      },
      limits,
    );
    expect(result).toMatchObject({
      approved: false,
      reason: "PORTFOLIO_FAILSAFE_ACTIVE",
      failsafe: true,
    });
  });

  it("aggregates long, short, gross, and net exposure per symbol", () => {
    expect(
      aggregatePositions([
        {
          strategyId: "ai",
          symbol: "BTC-USDT",
          side: "LONG",
          quantity: 0.2,
          markPrice: 100_000,
        },
        {
          strategyId: "mean",
          symbol: "BTC-USDT",
          side: "SHORT",
          quantity: 0.05,
          markPrice: 100_000,
        },
        {
          strategyId: "trend",
          symbol: "ETH-USDT",
          side: "LONG",
          quantity: 2,
          markPrice: 5_000,
        },
      ]),
    ).toEqual([
      {
        symbol: "BTC-USDT",
        longNotional: 20_000,
        shortNotional: 5_000,
        grossNotional: 25_000,
        netNotional: 15_000,
        strategyCount: 2,
      },
      {
        symbol: "ETH-USDT",
        longNotional: 10_000,
        shortNotional: 0,
        grossNotional: 10_000,
        netNotional: 10_000,
        strategyCount: 1,
      },
    ]);
  });
});
