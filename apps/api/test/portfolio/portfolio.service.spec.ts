import { StrategyKind, StrategyStatus, StrategyType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PortfolioService } from "../../src/modules/portfolio/application/portfolio.service";

describe("PortfolioService persistence", () => {
  it("does not persist the calculated-only disabled allocation flag", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const transactionClient = {
      strategyAllocation: { upsert },
      portfolioStrategy: { update: vi.fn() },
      portfolioRebalance: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      paperAccount: {
        findUnique: vi.fn().mockResolvedValue({ equity: 10_000 }),
      },
      portfolioStrategy: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "00000000-0000-4000-8000-000000000001",
            userId: "00000000-0000-4000-8000-000000000002",
            key: "ai-core",
            name: "AI Core",
            type: StrategyType.AI,
            kind: StrategyKind.AI_CORE,
            symbols: ["BTC-USDT"],
            status: StrategyStatus.ACTIVE,
            disabledReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            performance: null,
          },
        ]),
      },
      $transaction: vi.fn(
        (callback: (tx: typeof transactionClient) => Promise<void>) =>
          callback(transactionClient),
      ),
    };
    const config = {
      values: {
        maxStrategies: 5,
        maxTotalExposure: 0.6,
        maxStrategyExposure: 0.25,
        maxDrawdown: 0.2,
        disableMinTrades: 10,
        disableReturnPct: -0.1,
        disableWinRate: 0.35,
        rebalanceIntervalMs: 3_600_000,
      },
    };
    const service = new PortfolioService(prisma as never, config as never);
    vi.spyOn(service, "ensureDefaults").mockResolvedValue();

    await service.rebalance("00000000-0000-4000-8000-000000000002", "TEST");

    expect(upsert).toHaveBeenCalledWith({
      where: { strategyId: "00000000-0000-4000-8000-000000000001" },
      update: { weight: 0.25, allocatedCapital: 2500 },
      create: {
        strategyId: "00000000-0000-4000-8000-000000000001",
        weight: 0.25,
        allocatedCapital: 2500,
      },
    });
  });
});
