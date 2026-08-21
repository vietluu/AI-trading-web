import { describe, expect, it } from "vitest";

import { applyLivePositionUpdate } from "@/hooks/ai/useRealtimeLiveTrading";
import type { LiveTradingDashboard } from "@/services/ai-feature.service";

const baseDashboard: LiveTradingDashboard = {
  mode: "DEMO",
  globalTradingEnabled: true,
  liveTradingEnabled: true,
  connections: [],
  accounts: [
    {
      connectionId: "okx-1",
      totalEquity: 1_000,
      availableBalance: 800,
      unrealizedPnl: 0,
      marginBalance: 1_000,
      syncedAt: "2026-08-21T00:00:00.000Z",
    },
  ],
  positions: [],
  orders: [],
};

describe("realtime position updates", () => {
  it("updates every dashboard consumer with OKX-native mark price and PnL", () => {
    const updated = applyLivePositionUpdate(baseDashboard, {
      connectionId: "okx-1",
      positions: [
        {
          id: "okx-1:BNB-USDT:LONG",
          connectionId: "okx-1",
          provider: "OKX_FUTURES",
          symbol: "BNB-USDT",
          side: "LONG",
          quantity: 1.6,
          entryPrice: 661.9,
          markPrice: 660.6,
          liquidationPrice: 580,
          leverage: 7,
          unrealizedPnl: -2.08,
          realizedPnl: -0.53,
          notional: 1_056.96,
          syncedAt: "2026-08-21T02:20:00.000Z",
        },
      ],
    });

    expect(updated.positions[0]).toMatchObject({
      markPrice: 660.6,
      unrealizedPnl: -2.08,
    });
    expect(updated.accounts[0]?.unrealizedPnl).toBe(-2.08);
  });

  it("removes a closed position and resets that connection UPL", () => {
    const withPosition = applyLivePositionUpdate(baseDashboard, {
      connectionId: "okx-1",
      positions: [
        {
          id: "okx-1:BNB-USDT:LONG",
          connectionId: "okx-1",
          symbol: "BNB-USDT",
          side: "LONG",
          quantity: 1.6,
          entryPrice: 661.9,
          markPrice: 660.6,
          liquidationPrice: null,
          leverage: 7,
          unrealizedPnl: -2.08,
          syncedAt: "2026-08-21T02:20:00.000Z",
        },
      ],
    });
    const closed = applyLivePositionUpdate(withPosition, {
      connectionId: "okx-1",
      positions: [],
    });

    expect(closed.positions).toEqual([]);
    expect(closed.accounts[0]?.unrealizedPnl).toBe(0);
  });
});
