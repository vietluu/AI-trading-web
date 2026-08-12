import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LiveTradingService } from "../../src/modules/live-trading/application/live-trading.service";

const limits = {
  riskPerTrade: 0.02,
  maxPositions: 3,
  maxLeverage: 50,
  maxDrawdown: 0.15,
  maxExposure: 0.6,
  estimatedRoundTripCostPct: 0.0008,
  maxStopLossRoe: 0.03,
  rangeScalpRoeMultiplier: 2,
  minLiquidationBufferPct: 0.01,
};

interface LiveTradingInternals {
  monitorProtection: (
    userId: string,
    connection: unknown,
    positions: unknown[],
    context: Record<string, never>,
  ) => Promise<void>;
  assertExchangePortfolioRisk: (
    userId: string,
    connectionId: string,
    assessment: {
      symbol: string;
      positionSize: number;
      leverage: number;
      referencePrice: number;
      stopLoss: number;
      tradePlan?: { strategy: string };
    },
  ) => Promise<unknown>;
}

const internals = (service: LiveTradingService): LiveTradingInternals =>
  service as unknown as LiveTradingInternals;

function build() {
  const prisma = {
    liveOrder: {
      findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(),
    },
    liveAccountSnapshot: { findFirst: vi.fn(), aggregate: vi.fn() },
    livePosition: { findMany: vi.fn() },
  };
  const connections = {
    configuration: vi.fn().mockResolvedValue({ positionMode: "ONE_WAY" }),
    placeOrder: vi.fn(),
  };
  const service = new LiveTradingService(
    prisma as never,
    connections as never,
    { assertExecutionAllowed: vi.fn(), values: {} } as never,
    { record: vi.fn() } as never,
    { getUserLimits: vi.fn().mockResolvedValue(limits), values: limits } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, connections };
}

describe("live protection and exchange risk preflight", () => {
  it("submits a local reduce-only stop fallback for OKX when the stop is crossed", async () => {
    const { service, prisma, connections } = build();
    const source = {
      id: "open-1", userId: "user-1", connectionId: "conn-1",
      clientOrderId: "entry-1", symbol: "ETH-USDT", side: "BUY",
      leverage: 3, stopLoss: 100, takeProfit: 120, initialStopLoss: 100,
      tradePlan: null, strategyId: null, createdAt: new Date(),
    };
    prisma.liveOrder.findFirst.mockResolvedValue(source);
    prisma.liveOrder.findUnique.mockResolvedValue(null);
    prisma.liveOrder.create.mockResolvedValue({
      id: "stop-1", clientOrderId: "entry-1sl", quantity: 2,
    });
    connections.placeOrder.mockResolvedValue({
      exchangeOrderId: "exchange-stop-1", status: "NEW",
    });
    prisma.liveOrder.update.mockResolvedValue({
      id: "stop-1", exchangeOrderId: "exchange-stop-1",
      clientOrderId: "entry-1sl", provider: "OKX_FUTURES", environment: "DEMO",
      symbol: "ETH-USDT", side: "SELL", quantity: 2, averagePrice: null,
      status: "NEW", purpose: "STOP_LOSS", errorCode: null,
      createdAt: new Date(), updatedAt: new Date(),
    });

    await internals(service).monitorProtection(
      "user-1",
      { id: "conn-1", provider: "OKX_FUTURES", environment: "DEMO" },
      [{
        provider: "OKX_FUTURES", symbol: "ETH-USDT", side: "LONG",
        quantity: "2", entryPrice: "110", markPrice: "99", leverage: "3",
      }],
      {},
    );

    expect(connections.placeOrder).toHaveBeenCalledWith(
      "user-1", "conn-1",
      expect.objectContaining({
        symbol: "ETH-USDT", side: "SELL", quantity: "2", reduceOnly: true,
      }),
      {},
    );
    expect(JSON.stringify(prisma.liveOrder.create.mock.calls)).toContain('"purpose":"STOP_LOSS"');
    expect(JSON.stringify(prisma.liveOrder.create.mock.calls)).toContain('"reduceOnly":true');
  });

  it("uses user-specific limits and blocks a stale approval whose fee-inclusive loss exceeds 2% equity", async () => {
    const { service, prisma } = build();
    prisma.liveAccountSnapshot.findFirst.mockResolvedValue({
      totalEquity: 10_000, availableBalance: 10_000,
    });
    prisma.liveAccountSnapshot.aggregate.mockResolvedValue({ _max: { totalEquity: 10_000 } });
    prisma.livePosition.findMany.mockResolvedValue([]);

    await expect(internals(service)
      .assertExchangePortfolioRisk("user-1", "conn-1", {
        symbol: "ETH-USDT", positionSize: 2, leverage: 5,
        referencePrice: 2_000, stopLoss: 1_890,
      })).rejects.toThrow("risk per trade exceeded");
  });

  it("blocks leverage whose planned stop loss exceeds the margin ROE ceiling", async () => {
    const { service, prisma } = build();
    prisma.liveAccountSnapshot.findFirst.mockResolvedValue({
      totalEquity: 10_000, availableBalance: 10_000,
    });
    prisma.liveAccountSnapshot.aggregate.mockResolvedValue({ _max: { totalEquity: 10_000 } });
    prisma.livePosition.findMany.mockResolvedValue([]);

    await expect(internals(service)
      .assertExchangePortfolioRisk("user-1", "conn-1", {
        symbol: "ETH-USDT", positionSize: 0.1, leverage: 5,
        referencePrice: 2_000, stopLoss: 1_980,
      })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(internals(service)
      .assertExchangePortfolioRisk("user-1", "conn-1", {
        symbol: "ETH-USDT", positionSize: 0.1, leverage: 5,
        referencePrice: 2_000, stopLoss: 1_980,
      })).rejects.toThrow("stop-loss margin ROE exceeded");
  });

  it("accepts a higher leverage range scalp when stop ROE and liquidation buffer are safe", async () => {
    const { service, prisma } = build();
    prisma.liveAccountSnapshot.findFirst.mockResolvedValue({
      totalEquity: 10_000, availableBalance: 10_000,
    });
    prisma.liveAccountSnapshot.aggregate.mockResolvedValue({ _max: { totalEquity: 10_000 } });
    prisma.livePosition.findMany.mockResolvedValue([]);

    await expect(internals(service).assertExchangePortfolioRisk("user-1", "conn-1", {
      symbol: "SOL-USDT", positionSize: 1, leverage: 15,
      referencePrice: 100, stopLoss: 99.8,
      tradePlan: { strategy: "RANGE_REVERSAL" },
    })).resolves.toMatchObject({ leverage: 15 });
  });
});
