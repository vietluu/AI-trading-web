import { describe, expect, it } from "vitest";

import { calculateLiveTradingTotals } from "@/lib/live-trading-metrics";

describe("live trading dashboard metrics", () => {
  it("uses exchange-native position PnL without adjusting exchange equity twice", () => {
    expect(
      calculateLiveTradingTotals(
        [
          {
            totalEquity: 1_000,
            availableBalance: 800,
            unrealizedPnl: 11,
          },
        ],
        [{ unrealizedPnl: 12.5 }],
      ),
    ).toEqual({ equity: 1_000, available: 800, pnl: 12.5 });
  });

  it("falls back to account UPL when there are no position rows", () => {
    expect(
      calculateLiveTradingTotals(
        [
          {
            totalEquity: 500,
            availableBalance: 450,
            unrealizedPnl: -3,
          },
        ],
        [],
      ).pnl,
    ).toBe(-3);
  });
});
