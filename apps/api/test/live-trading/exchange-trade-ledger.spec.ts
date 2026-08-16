import { describe, expect, it, vi } from "vitest";

import { ExchangeTradeLedgerService } from "../../src/modules/live-trading/application/exchange-trade-ledger.service";

describe("ExchangeTradeLedgerService", () => {
  it("attributes an imported close to its opening strategy and stable trade cycle", async () => {
    const openedAt = new Date("2026-08-16T03:57:42.000Z");
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
      executedAt: new Date("2026-08-16T03:57:47.000Z"),
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
      id: "live-open",
      strategyId: "strategy-1",
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
        openedAt,
      }) as unknown,
      create: expect.objectContaining({
        strategyId: "strategy-1",
        openedAt,
      }) as unknown,
    }));
  });
});
