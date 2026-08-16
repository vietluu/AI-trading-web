import { describe, expect, it } from "vitest";

import { aggregateClosedTradeCycles } from "../../src/modules/live-trading/domain/closed-trade-cycle";

describe("aggregateClosedTradeCycles", () => {
  it("combines partial exits from one opening order without changing net PnL", () => {
    const openedAt = new Date("2026-08-16T03:57:42.000Z");
    const result = aggregateClosedTradeCycles([
      {
        id: "tp",
        connectionId: "connection-1",
        strategyId: "strategy-1",
        symbol: "LINK-USDT",
        positionSide: "SHORT",
        quantity: 200,
        entryPrice: 10,
        grossPnl: 12,
        fee: -2,
        netPnl: 10,
        returnPct: 0.005,
        sourceDataComplete: true,
        openedAt,
        closedAt: new Date("2026-08-16T04:10:00.000Z"),
      },
      {
        id: "residual",
        connectionId: "connection-1",
        strategyId: "strategy-1",
        symbol: "LINK-USDT",
        positionSide: "SHORT",
        quantity: 300,
        entryPrice: 10,
        grossPnl: -17,
        fee: -3,
        netPnl: -20,
        returnPct: -0.006666,
        sourceDataComplete: true,
        openedAt,
        closedAt: new Date("2026-08-16T04:35:00.000Z"),
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      tradeIds: ["tp", "residual"],
      quantity: 500,
      grossPnl: -5,
      fee: -5,
      netPnl: -10,
      returnPct: -0.002,
      sourceDataComplete: true,
      closedAt: new Date("2026-08-16T04:35:00.000Z"),
    });
  });

  it("does not merge records whose opening order is unknown", () => {
    const result = aggregateClosedTradeCycles([
      { id: "one", netPnl: 1, returnPct: 0.01 },
      { id: "two", netPnl: -1, returnPct: -0.01 },
    ]);

    expect(result).toHaveLength(2);
  });
});
