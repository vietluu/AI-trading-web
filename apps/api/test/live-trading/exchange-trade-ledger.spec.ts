import { describe, expect, it, vi } from "vitest";

import { ExchangeTradeLedgerService } from "../../src/modules/live-trading/application/exchange-trade-ledger.service";

describe("ExchangeTradeLedgerService", () => {
  it("persists fill pages in bounded idempotent batches without an interactive transaction", async () => {
    let activeUpserts = 0;
    let peakUpserts = 0;
    const upsert = vi.fn().mockImplementation(async () => {
      activeUpserts++;
      peakUpserts = Math.max(peakUpserts, activeUpserts);
      await Promise.resolve();
      activeUpserts--;
      return {};
    });
    const prisma = {
      $transaction: vi.fn(() => {
        throw new Error("interactive transaction must not be used");
      }),
      liveOrder: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      exchangeFill: {
        upsert,
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new ExchangeTradeLedgerService(prisma as never);
    const fills = Array.from({ length: 60 }, (_, index) => ({
      symbol: "LINK-USDT",
      exchangeTradeId: `trade-${index}`,
      exchangeOrderId: `order-${index}`,
      side: "BUY",
      price: "9.5",
      quantity: "1",
      realizedPnl: "0",
      fee: "-0.001",
      isClosing: false,
      executedAt: new Date(1_700_000_000_000 + index),
    }));

    const result = await service.ingest(
      "user-1",
      {
        id: "connection-1",
        provider: "OKX_FUTURES",
        environment: "DEMO",
      } as never,
      fills as never,
      { refreshDerived: false },
    );

    expect(result).toEqual({ fills: 60, closedTrades: 0 });
    expect(upsert).toHaveBeenCalledTimes(60);
    expect(peakUpserts).toBeLessThanOrEqual(25);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("attributes an imported close to its opening strategy and stable trade cycle", async () => {
    const openedAt = new Date("2026-08-16T03:57:42.000Z");
    const openingFillAt = new Date("2026-08-16T03:57:47.000Z");
    const closedAt = new Date("2026-08-16T04:35:01.000Z");
    const openingFill = {
      id: "fill-open",
      symbol: "LINK-USDT",
      exchangeTradeId: "trade-open",
      exchangeOrderId: "order-open",
      liveOrderId: "live-open",
      strategyId: "strategy-1",
      side: "SELL",
      positionSide: "SHORT",
      price: 9.402,
      quantity: 314,
      realizedPnl: 0,
      fee: -0.59,
      feeAsset: "USDT",
      isClosing: false,
      executedAt: openingFillAt,
    };
    const closingFill = {
      id: "fill-close",
      symbol: "LINK-USDT",
      exchangeTradeId: "trade-close",
      exchangeOrderId: "order-close",
      liveOrderId: "live-imported-close",
      strategyId: null,
      side: "BUY",
      positionSide: "SHORT",
      price: 9.45,
      quantity: 314,
      realizedPnl: -15.072,
      fee: -0.59,
      feeAsset: "USDT",
      isClosing: true,
      executedAt: closedAt,
    };
    const upsert = vi.fn().mockResolvedValue({
      id: "closed-1",
      userId: "user-1",
      symbol: "LINK-USDT",
      exchangeOrderId: "order-close",
      grossPnl: -15.072,
      fee: -1.18,
      netPnl: -16.252,
      returnPct: -0.0055,
      entryPrice: 9.402,
      exitPrice: 9.45,
      quantity: 314,
      closedAt,
      sourceDataComplete: true,
    });
    const findFirst = vi.fn().mockResolvedValue({
      id: "newer-but-unrelated-open",
      strategyId: "strategy-wrong",
      createdAt: openedAt,
    });
    const prisma = {
      exchangeFill: {
        findMany: vi.fn()
          .mockResolvedValueOnce([closingFill])
          .mockResolvedValueOnce([openingFill, closingFill]),
      },
      liveOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: "live-imported-close",
          strategyId: null,
          purpose: "IMPORTED",
        }),
        findFirst,
      },
      closedTrade: { upsert },
      knowledgeArchive: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const service = new ExchangeTradeLedgerService(prisma as never);

    const rebuilt = await (
      service as unknown as {
        rebuildClosedTrade(
          userId: string,
          connection: { id: string; provider: "OKX_FUTURES"; environment: "DEMO" },
          exchangeOrderId: string,
        ): Promise<boolean>;
      }
    ).rebuildClosedTrade(
      "user-1",
      { id: "connection-1", provider: "OKX_FUTURES", environment: "DEMO" },
      "order-close",
    );

    expect(rebuilt).toBe(true);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        symbol: "LINK-USDT",
        purpose: { in: ["OPEN", "REVERSE"] },
      }) as unknown,
    }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        strategyId: "strategy-1",
        openedAt: openingFillAt,
      }) as unknown,
      create: expect.objectContaining({
        strategyId: "strategy-1",
        openedAt: openingFillAt,
      }) as unknown,
    }));
  });
});
