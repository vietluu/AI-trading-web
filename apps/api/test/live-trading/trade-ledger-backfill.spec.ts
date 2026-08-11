import { describe, expect, it, vi } from "vitest";

import { LiveTradingService } from "../../src/modules/live-trading/application/live-trading.service";

describe("trade ledger backfill", () => {
  it("walks Binance fill history backwards using configured symbols", async () => {
    const oldest = new Date("2026-07-01T00:00:00.000Z");
    const fills = Array.from({ length: 1000 }, (_, index) => ({
      provider: "BINANCE_FUTURES",
      symbol: "ALGO-USDT",
      exchangeTradeId: String(index),
      exchangeOrderId: `order-${index}`,
      side: "BUY",
      price: "0.20",
      quantity: "1",
      realizedPnl: "0",
      fee: "-0.001",
      executedAt: new Date(oldest.getTime() + index),
    }));
    const tradeFills = vi.fn()
      .mockResolvedValueOnce(fills)
      .mockResolvedValueOnce([]);
    const ingest = vi.fn().mockResolvedValue({ fills: 1000, closedTrades: 4 });
    const refreshDerivedData = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      userSetting: { findUnique: vi.fn().mockResolvedValue({ preferredSymbols: ["algo/usdt"] }) },
      pipelineRun: { findMany: vi.fn().mockResolvedValue([]) },
      liveOrder: { findMany: vi.fn().mockResolvedValue([]) },
      livePosition: { findMany: vi.fn().mockResolvedValue([]) },
      tradeLedgerBackfillCheckpoint: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    const connections = {
      get: vi.fn().mockResolvedValue({
        id: "connection-1",
        provider: "BINANCE_FUTURES",
        environment: "PRODUCTION",
      }),
      tradeFills,
    };
    const service = new LiveTradingService(
      prisma as never,
      connections as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      { ingest, refreshDerivedData } as never,
    );

    const result = await service.backfillTradeLedger("user-1", "connection-1");

    expect(result).toMatchObject({
      status: "COMPLETED",
      symbols: ["ALGO-USDT"],
      pages: 2,
      processedFills: 1000,
      rebuiltClosedTrades: 4,
      reachedHistoryEnd: true,
    });
    expect(tradeFills).toHaveBeenNthCalledWith(
      2,
      "user-1",
      "connection-1",
      {},
      ["ALGO-USDT"],
      1000,
      new Date(oldest.getTime() - 1),
    );
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(refreshDerivedData).toHaveBeenCalledWith("user-1");
  });

  it("reports missing Binance symbols instead of falling back to BTC", async () => {
    const prisma = {
      userSetting: { findUnique: vi.fn().mockResolvedValue({ preferredSymbols: [] }) },
      pipelineRun: { findMany: vi.fn().mockResolvedValue([]) },
      liveOrder: { findMany: vi.fn().mockResolvedValue([]) },
      livePosition: { findMany: vi.fn().mockResolvedValue([]) },
      tradeLedgerBackfillCheckpoint: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
    };
    const tradeFills = vi.fn();
    const service = new LiveTradingService(
      prisma as never,
      {
        get: vi.fn().mockResolvedValue({ provider: "BINANCE_FUTURES" }),
        tradeFills,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      { ingest: vi.fn(), refreshDerivedData: vi.fn() } as never,
    );

    await expect(service.backfillTradeLedger("user-1", "connection-1")).resolves.toMatchObject({
      status: "NO_SYMBOLS_SELECTED",
      symbols: [],
      processedFills: 0,
    });
    expect(tradeFills).not.toHaveBeenCalled();
  });
});
