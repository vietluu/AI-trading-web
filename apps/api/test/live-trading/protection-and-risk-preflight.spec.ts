import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LiveTradingConfigService } from "../../src/modules/live-trading/application/live-trading-config.service";
import {
  LiveTradingService,
  processInBatches,
} from "../../src/modules/live-trading/application/live-trading.service";

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

describe("bounded live reconciliation batches", () => {
  it("processes every row without exceeding the database concurrency limit", async () => {
    let active = 0;
    let maximumActive = 0;
    const processed: number[] = [];

    await processInBatches([...Array(25).keys()], 10, async (row) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      processed.push(row);
      active -= 1;
    });

    expect(processed.sort((left, right) => left - right)).toEqual([...Array(25).keys()]);
    expect(maximumActive).toBe(10);
  });

  it("uses a 30-second default reconciliation cadence when no override is configured", () => {
    const config = new LiveTradingConfigService({
      get: vi.fn().mockImplementation((key: string) => {
        if (key === "GLOBAL_TRADING_ENABLED") return false;
        if (key === "LIVE_POSITION_SYNC_INTERVAL_MS") return undefined;
        return undefined;
      }),
    } as never);

    expect(config.values.syncIntervalMs).toBe(30_000);
  });
});

interface LiveTradingInternals {
  reconcileNativeProtection: (
    userId: string,
    connection: unknown,
    position: unknown,
    source: unknown,
    context: Record<string, never>,
  ) => Promise<string | null>;
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
    getProtectiveOrderStatus: vi.fn(),
    placeProtectiveOrder: vi.fn(),
  };
  const audit = { record: vi.fn() };
  const service = new LiveTradingService(
    prisma as never,
    connections as never,
    { assertExecutionAllowed: vi.fn(), values: {} } as never,
    audit as never,
    { getUserLimits: vi.fn().mockResolvedValue(limits), values: limits } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, connections, audit };
}

describe("live protection and exchange risk preflight", () => {
  it("waits for an effective protective child instead of creating a duplicate OCO", async () => {
    const { service, prisma, connections } = build();
    const source = {
      id: "open-triggered-1",
      clientOrderId: "entry-triggered-1",
      symbol: "ETH-USDT",
      stopLoss: 100,
      takeProfit: 120,
      protectiveClientOrderId: "protective-triggered-1",
      createdAt: new Date(),
    };
    connections.getProtectiveOrderStatus.mockResolvedValue("TERMINAL");

    await expect(
      internals(service).reconcileNativeProtection(
        "user-1",
        { id: "conn-1", provider: "OKX_FUTURES", environment: "DEMO" },
        { symbol: "ETH-USDT", side: "LONG", positionMode: "HEDGE" },
        source,
        {},
      ),
    ).resolves.toBe("protective-triggered-1");

    expect(connections.placeProtectiveOrder).not.toHaveBeenCalled();
    expect(prisma.liveOrder.update).not.toHaveBeenCalled();
  });

  it("recreates missing native TP/SL for an open OKX position", async () => {
    const { service, prisma, connections, audit } = build();
    prisma.liveOrder.findFirst.mockResolvedValue({
      id: "open-repair-1",
      clientOrderId: "entry-repair-1",
      symbol: "ETH-USDT",
      side: "BUY",
      leverage: 3,
      stopLoss: 100,
      takeProfit: 120,
      initialStopLoss: 100,
      protectiveClientOrderId: null,
      tradePlan: null,
      strategyId: null,
      createdAt: new Date(Date.now() - 180_000),
    });
    prisma.liveOrder.update.mockResolvedValue({});
    connections.placeProtectiveOrder.mockResolvedValue(undefined);

    await internals(service).monitorProtection(
      "user-1",
      { id: "conn-1", provider: "OKX_FUTURES", environment: "DEMO" },
      [
        {
          provider: "OKX_FUTURES",
          symbol: "ETH-USDT",
          side: "LONG",
          positionMode: "HEDGE",
          quantity: "2",
          entryPrice: "110",
          markPrice: "110",
          unrealizedPnl: "0",
          updatedAt: new Date(),
        },
      ],
      {},
    );

    expect(connections.placeProtectiveOrder).toHaveBeenCalledWith(
      "user-1",
      "conn-1",
      expect.objectContaining({
        symbol: "ETH-USDT",
        positionSide: "LONG",
        positionMode: "HEDGE",
        stopLoss: "100",
        takeProfit: "120",
      }),
      {},
    );
    expect(JSON.stringify(prisma.liveOrder.findFirst.mock.calls)).toContain(
      '"side":"BUY"',
    );
    expect(audit.record).toHaveBeenCalledWith(
      "PROTECTIVE_ORDER_RECOVERED",
      "user-1",
      {},
      expect.objectContaining({ symbol: "ETH-USDT" }),
    );
  });

  it("does not duplicate an OKX protective algo that is still effective", async () => {
    const { service, prisma, connections } = build();
    prisma.liveOrder.findFirst.mockResolvedValue({
      id: "open-protected-1",
      clientOrderId: "entry-protected-1",
      symbol: "ETH-USDT",
      side: "BUY",
      leverage: 3,
      stopLoss: 100,
      takeProfit: 120,
      initialStopLoss: 100,
      protectiveClientOrderId: "protective-1",
      tradePlan: null,
      strategyId: null,
      createdAt: new Date(Date.now() - 180_000),
    });
    connections.getProtectiveOrderStatus.mockResolvedValue("ACTIVE");

    await internals(service).monitorProtection(
      "user-1",
      { id: "conn-1", provider: "OKX_FUTURES", environment: "DEMO" },
      [
        {
          provider: "OKX_FUTURES",
          symbol: "ETH-USDT",
          side: "LONG",
          positionMode: "HEDGE",
          quantity: "2",
          entryPrice: "110",
          markPrice: "110",
          unrealizedPnl: "0",
          updatedAt: new Date(),
        },
      ],
      {},
    );

    expect(connections.getProtectiveOrderStatus).toHaveBeenCalled();
    expect(connections.placeProtectiveOrder).not.toHaveBeenCalled();
  });

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

  it("does not close a position only because its holding-candle horizon elapsed", async () => {
    const { service, prisma, connections } = build();
    prisma.liveOrder.findFirst.mockResolvedValue({
      id: "open-stale-1",
      clientOrderId: "entry-stale-1",
      symbol: "ETH-USDT",
      side: "BUY",
      leverage: 3,
      stopLoss: 98,
      takeProfit: 103,
      initialStopLoss: 98,
      protectiveClientOrderId: null,
      tradePlan: {
        approved: true,
        regime: "TREND_UP",
        strategy: "TREND_PULLBACK",
        maxHoldingCandles: 5,
        breakEvenAtR: 0.8,
        timeframeMs: 15 * 60_000,
      },
      strategyId: null,
      createdAt: new Date(Date.now() - 90 * 60_000),
      partialTakenAt: null,
      highestMark: null,
      lowestMark: null,
    });
    prisma.liveOrder.update.mockResolvedValue({});

    await internals(service).monitorProtection(
      "user-1",
      { id: "conn-1", provider: "BINANCE_FUTURES", environment: "TESTNET" },
      [{
        provider: "BINANCE_FUTURES",
        symbol: "ETH-USDT",
        side: "LONG",
        positionMode: "ONE_WAY",
        quantity: "2",
        entryPrice: "100",
        markPrice: "100.2",
        leverage: "3",
      }],
      {},
    );

    expect(connections.placeOrder).not.toHaveBeenCalled();
    expect(prisma.liveOrder.create).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// Collateral mismatch diagnostic (Task 1)
// ---------------------------------------------------------------------------

function buildForPipeline() {
  const pipelineAlert = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "alert-1" }),
  };
  const prisma = {
    liveOrder: { findFirst: vi.fn().mockResolvedValue(null) },
    liveAccountSnapshot: {
      findFirst: vi.fn().mockResolvedValue({
        totalEquity: 100_000,
        availableBalance: 4_000, // 4% – below 10% threshold
      }),
      aggregate: vi.fn().mockResolvedValue({ _max: { totalEquity: 100_000 } }),
    },
    livePosition: { findMany: vi.fn().mockResolvedValue([]) },
    closedTrade: { findMany: vi.fn().mockResolvedValue([]) },
    riskAssessment: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    pipelineAlert,
    $transaction: vi.fn().mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    ),
  };
  const connections = {
    list: vi.fn().mockResolvedValue([
      { id: "conn-1", provider: "OKX_FUTURES", environment: "DEMO", isEnabled: true, isVerified: true },
    ]),
    instrument: vi.fn().mockResolvedValue({ symbol: "BTC-USDT" }),
  };
  const publicExchanges = {
    ticker: vi.fn().mockResolvedValue({ markPrice: "50000" }),
  };
  const risk = {
    assess: vi.fn().mockResolvedValue({ approved: false, reason: "test", riskScore: 10 }),
  };
  const portfolio = {
    prepareStrategy: vi.fn().mockResolvedValue({ id: "strategy-1" }),
  };
  const config = {
    values: {
      mode: "DEMO" as const,
      approvalTtlMs: 60_000,
      cooldownMs: 0,
      runtimeEnabled: true,
      liveEnabled: false,
      availableCollateralWarningRatio: 0.1,
    },
    assertExecutionAllowed: vi.fn(),
  };
  const service = new LiveTradingService(
    prisma as never,
    connections as never,
    config as never,
    { record: vi.fn() } as never,
    { getUserLimits: vi.fn().mockResolvedValue(limits), values: limits } as never,
    risk as never,
    portfolio as never,
    publicExchanges as never,
  );
  vi.spyOn(
    service as unknown as { sync: (...args: unknown[]) => Promise<void> },
    "sync",
  ).mockResolvedValue(undefined);
  return { service, prisma, pipelineAlert };
}

describe("assessPipelineDecision collateral mismatch alert", () => {
  it("creates one ACCOUNT_COLLATERAL_MISMATCH alert when available collateral ratio is below threshold", async () => {
    const { service, pipelineAlert } = buildForPipeline();

    await service.assessPipelineDecision({
      userId: "user-1",
      pipelineRunId: "run-colat-1",
      symbol: "BTC-USDT",
      provider: "OKX_FUTURES" as never,
      decision: { decision: "LONG", confidence: 70 } as never,
    });

    expect(pipelineAlert.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kind: "ACCOUNT_COLLATERAL_MISMATCH" }) as unknown,
      }),
    );
    expect(pipelineAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "ACCOUNT_COLLATERAL_MISMATCH",
          symbol: "BTC-USDT",
        }) as unknown,
      }),
    );
  });

  it("does not duplicate the alert when one already exists for the run", async () => {
    const { service, prisma, pipelineAlert } = buildForPipeline();
    // Simulate existing alert on the second call
    pipelineAlert.findFirst.mockResolvedValueOnce({ id: "alert-existing" });

    await service.assessPipelineDecision({
      userId: "user-1",
      pipelineRunId: "run-colat-2",
      symbol: "BTC-USDT",
      provider: "OKX_FUTURES" as never,
      decision: { decision: "LONG", confidence: 70 } as never,
    });

    // findFirst was called but create must NOT be called again
    expect(pipelineAlert.create).not.toHaveBeenCalled();
    void prisma; // used above
  });
});

