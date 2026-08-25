import {
  Prisma,
  StrategyKind,
  StrategyStatus,
  StrategyType,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PortfolioService } from "../../src/modules/portfolio/application/portfolio.service";

describe("PortfolioService persistence", () => {
  it("synchronizes default strategy metadata with settings and enabled schedules", async () => {
    const strategyUpsert = vi.fn().mockImplementation(
      ({ create }: { create: { key: string } }) =>
        Promise.resolve({ id: `strategy-${create.key}` }),
    );
    const prisma = {
      userSetting: {
        findUnique: vi.fn().mockResolvedValue({ preferredSymbols: ["sol_usdt"] }),
      },
      pipelineSchedule: {
        findMany: vi.fn().mockResolvedValue([{ symbols: ["BNB-USDT", "ZRO-USDT"] }]),
      },
      portfolioStrategy: { upsert: strategyUpsert },
      strategyPerformance: { upsert: vi.fn() },
      strategyAllocation: { upsert: vi.fn() },
    };
    const service = new PortfolioService(
      prisma as never,
      { values: { maxStrategies: 5 } } as never,
    );

    await service.ensureDefaults("user-1");

    expect(strategyUpsert).toHaveBeenCalledTimes(5);
    expect(strategyUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { symbols: ["SOL-USDT", "BNB-USDT", "ZRO-USDT"] },
      create: expect.objectContaining({
        symbols: ["SOL-USDT", "BNB-USDT", "ZRO-USDT"],
      }) as unknown,
    }));
  });

  it("registers pipeline strategies and symbols without reactivating an existing strategy", async () => {
    const strategyUpsert = vi.fn().mockResolvedValue({ id: "strategy-momentum" });
    const prisma = {
      userSetting: {
        findUnique: vi.fn().mockResolvedValue({ preferredSymbols: ["BTC-USDT"] }),
      },
      pipelineSchedule: {
        findMany: vi.fn().mockResolvedValue([{ symbols: ["ETH-USDT"] }]),
      },
      portfolioStrategy: { upsert: strategyUpsert },
      strategyPerformance: { upsert: vi.fn() },
      strategyAllocation: { upsert: vi.fn() },
    };
    const service = new PortfolioService(
      prisma as never,
      { values: { maxStrategies: 5 } } as never,
    );

    await service.ensureRegisteredStrategies(
      "user-1",
      ["momentum-scalp"],
      ["sol_usdt"],
    );

    expect(strategyUpsert).toHaveBeenCalledWith({
      where: { userId_key: { userId: "user-1", key: "momentum-scalp" } },
      update: { symbols: ["BTC-USDT", "ETH-USDT", "SOL-USDT"] },
      create: {
        userId: "user-1",
        key: "momentum-scalp",
        name: "Momentum Scalp",
        type: StrategyType.HYBRID,
        kind: StrategyKind.BREAKOUT,
        symbols: ["BTC-USDT", "ETH-USDT", "SOL-USDT"],
      },
    });
  });

  it("does not persist the calculated-only disabled allocation flag", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const transactionClient = {
      strategyAllocation: { upsert },
      portfolioStrategy: { update: vi.fn() },
      portfolioRebalance: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      exchangeConnection: {
        findMany: vi.fn().mockResolvedValue([{ id: "connection-1" }]),
      },
      livePosition: { findMany: vi.fn().mockResolvedValue([]) },
      liveAccountSnapshot: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              connectionId: "connection-1",
              totalEquity: new Prisma.Decimal(10_000),
              unrealizedPnl: new Prisma.Decimal(0),
              syncedAt: new Date(),
            },
          ]),
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
      marketRegimeState: { findFirst: vi.fn().mockResolvedValue(null) },
      quantRecommendation: {
        deleteMany: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(
        (callback: (tx: typeof transactionClient) => Promise<void>) =>
          callback(transactionClient),
      ),
    };
    const config = {
      tradingMode: "DEMO",
      liveStaleAfterMs: 60_000,
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

  it("uses synchronized exchange equity and positions in DEMO mode", async () => {
    const now = new Date();
    const strategyId = "00000000-0000-4000-8000-000000000001";
    const userId = "00000000-0000-4000-8000-000000000002";
    const prisma = {
      exchangeConnection: {
        findMany: vi.fn().mockResolvedValue([{ id: "connection-1" }]),
      },
      livePosition: {
        findMany: vi.fn().mockResolvedValue([
          {
            strategyId,
            connectionId: "connection-1",
            symbol: "BTC-USDT",
            side: "LONG",
            quantity: new Prisma.Decimal(0.1),
            entryPrice: new Prisma.Decimal(90_000),
            markPrice: new Prisma.Decimal(100_000),
            notional: new Prisma.Decimal(10_000),
            unrealizedPnl: new Prisma.Decimal(1_000),
            realizedPnl: new Prisma.Decimal(50),
          },
        ]),
      },
      liveAccountSnapshot: {
        findMany: vi.fn().mockResolvedValue([
          {
            connectionId: "connection-1",
            totalEquity: new Prisma.Decimal(25_000),
            unrealizedPnl: new Prisma.Decimal(1_000),
            syncedAt: now,
          },
        ]),
      },
      portfolioStrategy: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: strategyId,
            key: "ai-core",
            name: "AI Core",
            type: StrategyType.AI,
            kind: StrategyKind.AI_CORE,
            symbols: ["BTC-USDT"],
            status: StrategyStatus.ACTIVE,
            disabledReason: null,
            allocation: {
              weight: 0.25,
              allocatedCapital: new Prisma.Decimal(6_250),
            },
            performance: null,
            positions: [],
          },
        ]),
      },
      portfolioRiskEvent: { findMany: vi.fn().mockResolvedValue([]) },
      portfolioRebalance: { findMany: vi.fn().mockResolvedValue([]) },
      liveOrder: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const config = {
      tradingMode: "DEMO",
      liveStaleAfterMs: 60_000,
      paperInitialBalance: 10_000,
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

    const result = (await service.dashboard(userId)) as {
      source: { kind: string; available: boolean };
      portfolio: { equity: number; pnl: number; grossExposure: number };
      strategies: Array<{
        exposure: number;
        performance: { returnPct: number };
      }>;
    };

    expect(result.source).toMatchObject({ kind: "EXCHANGE", available: true });
    expect(result.portfolio).toMatchObject({
      equity: 25_000,
      pnl: 1_050,
      grossExposure: 10_000,
    });
    expect(result.strategies[0]).toMatchObject({
      exposure: 10_000,
      performance: { returnPct: 0.168 },
    });
  });
});
