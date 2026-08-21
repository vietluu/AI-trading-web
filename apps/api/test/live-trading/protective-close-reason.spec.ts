import { describe, expect, it } from "vitest";
import { inferProtectiveClosePurpose } from "../../src/modules/live-trading/domain/protective-close-reason";

const openingOrders = [
  {
    symbol: "SOL-USDT",
    side: "BUY",
    stopLoss: "90.39278498",
    takeProfit: "91.84846863",
    protectiveClientOrderId: "entry-protective-1",
    createdAt: new Date("2026-08-21T06:03:42.289Z"),
  },
];

describe("protective close reason", () => {
  it("classifies an OKX algo child filled near the stop as STOP_LOSS", () => {
    expect(
      inferProtectiveClosePurpose(
        {
          symbol: "SOL-USDT",
          side: "SELL",
          status: "FILLED",
          reduceOnly: true,
          averagePrice: "90.39",
          sourceCode: "13",
          algoClientOrderId: "entry-protective-1",
          createdAt: new Date("2026-08-21T06:22:13.303Z"),
        },
        openingOrders,
      ),
    ).toBe("STOP_LOSS");
  });

  it("classifies an OKX TP/SL child filled near the target as TAKE_PROFIT", () => {
    expect(
      inferProtectiveClosePurpose(
        {
          symbol: "SOL-USDT",
          side: "SELL",
          status: "FILLED",
          reduceOnly: true,
          averagePrice: "91.85",
          sourceCode: "7",
          createdAt: new Date("2026-08-21T06:20:00.000Z"),
        },
        openingOrders,
      ),
    ).toBe("TAKE_PROFIT");
  });

  it("does not relabel manual or unknown external closes", () => {
    expect(
      inferProtectiveClosePurpose(
        {
          symbol: "SOL-USDT",
          side: "SELL",
          status: "FILLED",
          reduceOnly: true,
          averagePrice: "90.39",
          createdAt: new Date("2026-08-21T06:22:13.303Z"),
        },
        openingOrders,
      ),
    ).toBeUndefined();
  });
});
