import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ExchangeError, ExchangeErrorCode } from "../src/exchange/domain/exchange.error";
import { ExchangeProvider } from "../src/exchange/domain/exchange.types";
import { LiveTradingService } from "../src/modules/live-trading/application/live-trading.service";

const createPrisma = () => ({
  riskAssessment: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  liveOrder: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  livePosition: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  closedTrade: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  pipelineRun: {
    findUnique: vi.fn(),
  },
  liveAccountSnapshot: {
    findFirst: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
});

describe("live trading duplicate order protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a second order for the same symbol and protection levels", async () => {
    const prisma = createPrisma();
    prisma.riskAssessment.findFirst.mockResolvedValue({
      id: "risk-1",
      approved: true,
      positionSize: 0.1,
      leverage: 3,
      decision: "LONG",
      symbol: "BTC-USDT",
      stopLoss: 60000,
      takeProfit: 65000,
      strategyId: "strategy-1",
      createdAt: new Date(),
    });
    prisma.liveOrder.findUnique.mockResolvedValue(null);
    prisma.livePosition.findFirst.mockResolvedValue(null);
    prisma.liveOrder.findFirst.mockResolvedValue({ id: "existing-order" });
    prisma.liveAccountSnapshot.findFirst.mockResolvedValue({ totalEquity: 1000, availableBalance: 1000 });
    prisma.liveAccountSnapshot.aggregate.mockResolvedValue({ _max: { totalEquity: 1000 } });
    prisma.livePosition.findMany.mockResolvedValue([]);

    const service = new LiveTradingService(
      prisma as never,
      {
        get: vi.fn().mockResolvedValue({ id: "conn-1", environment: "DEMO", isEnabled: true, isVerified: true, provider: "OKX_FUTURES" }),
        configuration: vi.fn().mockResolvedValue({ positionMode: "ONE_WAY" }),
        placeOrder: vi.fn(),
      } as never,
      { values: { mode: "DEMO", approvalTtlMs: 60_000, cooldownMs: 0, runtimeEnabled: true, liveEnabled: true }, assertExecutionAllowed: vi.fn() } as never,
      { record: vi.fn() } as never,
      { values: { maxDrawdown: 0.9, maxLeverage: 10, maxPositions: 10, maxExposure: 1 } } as never,
      { assess: vi.fn() } as never,
      { assessTrade: vi.fn() } as never,
      { ticker: vi.fn(), prepareStrategy: vi.fn().mockResolvedValue({ id: "strategy-1" }) } as never,
    );
    vi.spyOn(service as unknown as { sync: (...args: unknown[]) => Promise<void> }, "sync").mockResolvedValue(undefined);

    await expect(
      service.execute(
        "user-1",
        {
          connectionId: "conn-1",
          riskAssessmentId: "risk-1",
          clientOrderId: "test-order",
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(JSON.stringify(prisma.liveOrder.findFirst.mock.calls)).toContain(
      '"status":{"in":["SUBMITTING","NEW","PARTIALLY_FILLED"]}',
    );
  });

  it("returns an empty dashboard snapshot when the user id is not a valid UUID", async () => {
    const prisma = createPrisma();
    const service = new LiveTradingService(
      prisma as never,
      {
        list: vi.fn().mockRejectedValue(new Error("connections.list should not run")),
      } as never,
      { values: { mode: "DEMO", approvalTtlMs: 60_000, cooldownMs: 0, runtimeEnabled: true, liveEnabled: true }, assertExecutionAllowed: vi.fn() } as never,
      { record: vi.fn() } as never,
      { values: { maxDrawdown: 0.9, maxLeverage: 10, maxPositions: 10, maxExposure: 1 } } as never,
      { assess: vi.fn() } as never,
      { assessTrade: vi.fn() } as never,
      { ticker: vi.fn(), prepareStrategy: vi.fn() } as never,
    );

    const result = await service.dashboard("demo");

    expect(result).toMatchObject({
      connections: [],
      accounts: [],
      positions: [],
      orders: [],
    });
    expect(prisma.livePosition.findMany).not.toHaveBeenCalled();
  });

  it("serializes net realized PnL and its fee breakdown for trade history", () => {
    const service = new LiveTradingService(
      createPrisma() as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = (
      service as unknown as {
        closedTradePnlView(trade?: {
          grossPnl: number;
          fee: number;
          netPnl: number;
          returnPct: number | null;
          closeReason: string;
        }): Record<string, unknown>;
      }
    ).closedTradePnlView({
      grossPnl: 12.5,
      fee: -2.5,
      netPnl: 10,
      returnPct: 0.01,
      closeReason: "TAKE_PROFIT",
    });

    expect(result).toEqual({
      grossPnl: 12.5,
      fee: -2.5,
      netPnl: 10,
      returnPct: 0.01,
      closeReason: "TAKE_PROFIT",
    });
  });

  it("preserves the original blocker message for non-exchange execution failures", () => {
    const service = new LiveTradingService(
      createPrisma() as never,
      {
        get: vi.fn(),
      } as never,
      { values: { mode: "DEMO", approvalTtlMs: 60_000, cooldownMs: 0, runtimeEnabled: true, liveEnabled: true }, assertExecutionAllowed: vi.fn() } as never,
      { record: vi.fn() } as never,
      { values: { maxDrawdown: 0.9, maxLeverage: 10, maxPositions: 10, maxExposure: 1 } } as never,
      { assess: vi.fn() } as never,
      { assessTrade: vi.fn() } as never,
      { ticker: vi.fn(), prepareStrategy: vi.fn() } as never,
    );

    const result = (service as unknown as {
      safeError: (error: unknown) => { code: string; message: string };
    }).safeError(
      new ConflictException("A position already exists in the approved direction"),
    );

    expect(result.code).toBe("EXECUTION_FAILED");
    expect(result.message).toContain("A position already exists in the approved direction");
  });

  it("returns the blocker message when pipeline execution fails before submission", async () => {
    const prisma = createPrisma();
    prisma.riskAssessment.findUnique.mockResolvedValue({
      id: "risk-1",
      userId: "user-1",
      approved: true,
      reason: "ok",
    });
    prisma.pipelineRun.findUnique.mockResolvedValue({ provider: "OKX_FUTURES" });

    const service = new LiveTradingService(
      prisma as never,
      {
        list: vi.fn().mockResolvedValue([
          {
            id: "conn-1",
            provider: "OKX_FUTURES",
            environment: "DEMO",
            isEnabled: true,
            isVerified: true,
          },
        ]),
      } as never,
      { values: { mode: "DEMO", approvalTtlMs: 60_000, cooldownMs: 0, runtimeEnabled: true, liveEnabled: true }, assertExecutionAllowed: vi.fn() } as never,
      { record: vi.fn() } as never,
      { values: { maxDrawdown: 0.9, maxLeverage: 10, maxPositions: 10, maxExposure: 1 } } as never,
      { assess: vi.fn() } as never,
      { assessTrade: vi.fn() } as never,
      { ticker: vi.fn(), prepareStrategy: vi.fn() } as never,
    );
    vi.spyOn(service as never, "execute").mockRejectedValue(new ConflictException("A position already exists in the approved direction"));

    const result = await service.executePipeline("user-1", "run-1");

    expect(result).toMatchObject({
      outcome: "EXECUTION_FAILED",
      errorCode: "EXECUTION_FAILED",
    });
    expect(result.errorMessage).toContain("A position already exists in the approved direction");
  });

  it("generates an OKX-compatible client order id for pipeline execution", async () => {
    const prisma = createPrisma();
    prisma.riskAssessment.findUnique.mockResolvedValue({
      id: "risk-1",
      userId: "user-1",
      approved: true,
      reason: "ok",
    });
    prisma.pipelineRun.findUnique.mockResolvedValue({ provider: "OKX_FUTURES" });

    const service = new LiveTradingService(
      prisma as never,
      {
        list: vi.fn().mockResolvedValue([
          {
            id: "conn-1",
            provider: "OKX_FUTURES",
            environment: "DEMO",
            isEnabled: true,
            isVerified: true,
          },
        ]),
      } as never,
      { values: { mode: "DEMO", approvalTtlMs: 60_000, cooldownMs: 0, runtimeEnabled: true, liveEnabled: true }, assertExecutionAllowed: vi.fn() } as never,
      { record: vi.fn() } as never,
      { values: { maxDrawdown: 0.9, maxLeverage: 10, maxPositions: 10, maxExposure: 1 } } as never,
      { assess: vi.fn() } as never,
      { assessTrade: vi.fn() } as never,
      { ticker: vi.fn(), prepareStrategy: vi.fn() } as never,
    );
    const executeSpy = vi.spyOn(
      service as unknown as { execute: (...args: unknown[]) => Promise<{ id: string }> },
      "execute",
    ).mockResolvedValue({ id: "order-1" });

    await service.executePipeline("user-1", "run-1");
    await service.executePipeline("user-1", "run-1");

    const [, dto] = executeSpy.mock.calls[0] as [string, { clientOrderId: string }];
    const [, retryDto] = executeSpy.mock.calls[1] as [string, { clientOrderId: string }];
    expect(dto.clientOrderId).toMatch(/^[A-Za-z0-9]+$/);
    expect(dto.clientOrderId.length).toBeLessThanOrEqual(32);
    expect(retryDto.clientOrderId).toBe(dto.clientOrderId);
  });

  it("marks exchange 429/503-class failures as retryable for the pipeline", async () => {
    const prisma = createPrisma();
    prisma.riskAssessment.findUnique.mockResolvedValue({
      id: "risk-1", userId: "user-1", approved: true, reason: "ok",
    });
    const service = new LiveTradingService(
      prisma as never,
      { list: vi.fn().mockResolvedValue([{
        id: "conn-1", provider: "OKX_FUTURES", environment: "DEMO",
        isEnabled: true, isVerified: true,
      }]) } as never,
      { values: { mode: "DEMO", runtimeEnabled: true } } as never,
      { record: vi.fn() } as never,
      {} as never, {} as never, {} as never, {} as never,
    );
    vi.spyOn(service as never, "execute").mockRejectedValue(new ExchangeError(
      ExchangeErrorCode.RATE_LIMITED,
      ExchangeProvider.OKX_FUTURES,
      true,
      429,
      "rate limited",
    ));

    await expect(service.executePipeline("user-1", "run-1")).resolves.toMatchObject({
      outcome: "EXECUTION_FAILED",
      errorCode: "EXCHANGE_RATE_LIMITED",
      retryable: true,
    });
  });

  it("reuses the failed local order row when a retry uses the same approval", async () => {
    const prisma = createPrisma();
    prisma.liveOrder.findUnique.mockResolvedValue({ id: "order-1", status: "FAILED" });
    const timestamp = new Date();
    prisma.liveOrder.update
      .mockResolvedValueOnce({ id: "order-1", status: "SUBMITTING", createdAt: timestamp, updatedAt: timestamp })
      .mockResolvedValueOnce({ id: "order-1", status: "NEW", exchangeOrderId: "exchange-1", createdAt: timestamp, updatedAt: timestamp });
    const connections = {
      placeOrder: vi.fn().mockResolvedValue({ exchangeOrderId: "exchange-1", status: "NEW" }),
    };
    const service = new LiveTradingService(
      prisma as never, connections as never, {} as never,
      { record: vi.fn() } as never,
      {} as never, {} as never, {} as never, {} as never,
    );

    await (service as unknown as {
      submit: (...args: unknown[]) => Promise<unknown>;
    }).submit(
      "user-1",
      { id: "conn-1", provider: "OKX_FUTURES", environment: "DEMO" },
      { symbol: "ETH-USDT", side: "BUY", quantity: "0.1", leverage: 2, clientOrderId: "stable1" },
      "OPEN",
      { id: "risk-1", stopLoss: null, takeProfit: null, tradePlan: null },
      "strategy-1",
      {},
    );

    expect(prisma.liveOrder.create).not.toHaveBeenCalled();
    expect(prisma.liveOrder.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "order-1" },
      data: expect.objectContaining({ status: "SUBMITTING", clientOrderId: "stable1" }) as unknown,
    }));
    expect(connections.placeOrder).toHaveBeenCalledTimes(1);
  });

  it("checks environment-specific instrument support before creating an order row", async () => {
    const prisma = createPrisma();
    const unavailable = new ExchangeError(
      ExchangeErrorCode.INVALID_SYMBOL,
      ExchangeProvider.OKX_FUTURES,
      false,
      400,
      "Exchange symbol OKB-USDT is unavailable in DEMO",
    );
    const connections = {
      instrument: vi.fn().mockRejectedValue(unavailable),
      placeOrder: vi.fn(),
    };
    const service = new LiveTradingService(
      prisma as never,
      connections as never,
      {} as never,
      { record: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      (service as unknown as {
        submit: (...args: unknown[]) => Promise<unknown>;
      }).submit(
        "user-1",
        { id: "conn-1", provider: "OKX_FUTURES", environment: "DEMO" },
        {
          symbol: "OKB-USDT",
          side: "BUY",
          quantity: "1",
          leverage: 2,
          clientOrderId: "okb-demo",
        },
        "OPEN",
        null,
        null,
        {},
      ),
    ).rejects.toBe(unavailable);
    expect(prisma.liveOrder.create).not.toHaveBeenCalled();
    expect(connections.placeOrder).not.toHaveBeenCalled();
  });

  it("auto-reduces size to fit available balance when margin is insufficient", () => {
    const service = new LiveTradingService(
      createPrisma() as never,
      {
        get: vi.fn(),
      } as never,
      { values: { mode: "DEMO", approvalTtlMs: 60_000, cooldownMs: 0, runtimeEnabled: true, liveEnabled: true }, assertExecutionAllowed: vi.fn() } as never,
      { record: vi.fn() } as never,
      { values: { maxDrawdown: 0.9, maxLeverage: 10, maxPositions: 10, maxExposure: 1 } } as never,
      { assess: vi.fn() } as never,
      { assessTrade: vi.fn() } as never,
      { ticker: vi.fn(), prepareStrategy: vi.fn() } as never,
    );

    const result = (service as unknown as {
      deriveExecutionSizing: (
        assessment: { positionSize: number; leverage: number; referencePrice: number },
        availableBalance: number,
        maxLeverage: number,
      ) => { positionSize: number; leverage: number };
    }).deriveExecutionSizing(
      { positionSize: 0.24, leverage: 5, referencePrice: 64300 },
      1000,
      10,
    );

    expect(result.leverage).toBeLessThanOrEqual(5);
    expect(result.positionSize).toBeLessThanOrEqual(0.24);
    expect(result.positionSize * 64300 / result.leverage).toBeLessThanOrEqual(1000);
  });

  it("caps execution sizing by a conservative exposure fraction", () => {
    const service = new LiveTradingService(
      createPrisma() as never,
      {
        get: vi.fn(),
      } as never,
      { values: { mode: "DEMO", approvalTtlMs: 60_000, cooldownMs: 0, runtimeEnabled: true, liveEnabled: true }, assertExecutionAllowed: vi.fn() } as never,
      { record: vi.fn() } as never,
      { values: { maxDrawdown: 0.9, maxLeverage: 10, maxPositions: 10, maxExposure: 1 } } as never,
      { assess: vi.fn() } as never,
      { assessTrade: vi.fn() } as never,
      { ticker: vi.fn(), prepareStrategy: vi.fn() } as never,
    );

    const result = (service as unknown as {
      deriveExecutionSizing: (
        assessment: { positionSize: number; leverage: number; referencePrice: number },
        availableBalance: number,
        maxLeverage: number,
        equity?: number,
        maxExposure?: number,
      ) => { positionSize: number; leverage: number };
    }).deriveExecutionSizing(
      { positionSize: 0.24, leverage: 5, referencePrice: 64300 },
      1000,
      10,
      10000,
      0.25,
    );

    expect(result.positionSize).toBeLessThanOrEqual(10000 * 0.25 / 64300);
  });

  it("updates an earlier pending approval when a newer signal is better priced", async () => {
    const prisma = createPrisma();
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma));
    prisma.liveAccountSnapshot.findFirst.mockResolvedValue({
      totalEquity: 1000,
      availableBalance: 1000,
    });
    prisma.liveAccountSnapshot.aggregate.mockResolvedValue({ _max: { totalEquity: 1000 } });
    prisma.livePosition.findMany.mockResolvedValue([]);
    prisma.liveOrder.findFirst.mockResolvedValue(null);
    prisma.riskAssessment.findMany.mockResolvedValue([
      {
        id: "existing-risk",
        userId: "user-1",
        strategyId: "strategy-1",
        pipelineRunId: "old-run",
        symbol: "BTC-USDT",
        decision: "LONG",
        confidence: 0.9,
        approved: true,
        reason: "ok",
        positionSize: 0.1,
        leverage: 3,
        stopLoss: 60000,
        takeProfit: 65000,
        riskScore: 20,
        referencePrice: 62000,
        volatility: 0.02,
        exposurePct: 0.1,
        drawdownPct: 0.01,
        createdAt: new Date(),
      },
    ]);
    prisma.riskAssessment.updateMany.mockResolvedValue({ count: 1 });

    const connections = {
      list: vi.fn().mockResolvedValue([
        {
          id: "conn-1",
          provider: "OKX_FUTURES",
          environment: "DEMO",
          isEnabled: true,
          isVerified: true,
        },
      ]),
    };
    const publicExchanges = { ticker: vi.fn().mockResolvedValue({ markPrice: 61000 }) };
    const portfolio = {
      prepareStrategy: vi.fn().mockResolvedValue({ id: "strategy-1" }),
      assessTrade: vi.fn().mockResolvedValue({ approved: true, approvedNotional: 61000 }),
    };
    const risk = {
      assess: vi.fn().mockResolvedValue({
        approved: true,
        reason: "ok",
        riskScore: 18,
        positionSize: 0.1,
        leverage: 3,
        stopLoss: 59800,
        takeProfit: 66000,
      }),
    };

    const service = new LiveTradingService(
      prisma as never,
      connections as never,
      { values: { mode: "DEMO", approvalTtlMs: 60_000, cooldownMs: 0, runtimeEnabled: true, liveEnabled: true }, assertExecutionAllowed: vi.fn() } as never,
      { record: vi.fn() } as never,
      { values: { maxDrawdown: 0.9, maxLeverage: 10, maxPositions: 10, maxExposure: 1 } } as never,
      risk as never,
      portfolio as never,
      publicExchanges as never,
    );
vi.spyOn(service as unknown as { sync: (...args: unknown[]) => Promise<void> }, "sync").mockResolvedValue(undefined);

    await service.assessPipelineDecision({
      userId: "user-1",
      pipelineRunId: "new-run",
      symbol: "BTC-USDT",
      provider: "OKX_FUTURES" as never,
      decision: { decision: "LONG", confidence: 0.95 } as never,
      volatilityAtr: 0.02,
    });

    expect(prisma.riskAssessment.updateMany).toHaveBeenCalled();
    expect(JSON.stringify(prisma.liveOrder.findFirst.mock.calls)).toContain(
      '"symbol":"BTC-USDT","side":"BUY"',
    );
    expect(JSON.stringify(prisma.riskAssessment.update.mock.calls)).toContain(
      '"pipelineRunId":"new-run"',
    );
    expect(JSON.stringify(prisma.riskAssessment.update.mock.calls)).toContain(
      '"positionSize":0.048196721311',
    );
  });
});
