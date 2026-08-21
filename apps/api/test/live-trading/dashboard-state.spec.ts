import { describe, expect, it } from "vitest";

import { ExchangeProvider, type ExchangeOrder } from "../../src/exchange/domain/exchange.types";
import {
  isAuthoritativeDashboardOrder,
  isPastProtectionOrphanGrace,
} from "../../src/modules/live-trading/application/live-trading.service";

const exchangeOrder = {
  provider: ExchangeProvider.OKX_FUTURES,
  symbol: "BTC-USDT",
  exchangeOrderId: "exchange-open-1",
  clientOrderId: "client-open-1",
  side: "BUY",
  type: "LIMIT",
  status: "NEW",
  originalQuantity: "1",
  executedQuantity: "0",
} as ExchangeOrder;

describe("live dashboard authoritative order state", () => {
  it("hides a locally active order absent from the exchange snapshot", () => {
    expect(
      isAuthoritativeDashboardOrder(
        {
          status: "NEW",
          exchangeOrderId: "stale-exchange-id",
          clientOrderId: "stale-client-id",
        },
        [],
      ),
    ).toBe(false);
  });

  it("keeps exchange-confirmed open orders and terminal history", () => {
    expect(
      isAuthoritativeDashboardOrder(
        {
          status: "NEW",
          exchangeOrderId: exchangeOrder.exchangeOrderId,
          clientOrderId: "different-client-id",
        },
        [exchangeOrder],
      ),
    ).toBe(true);
    expect(
      isAuthoritativeDashboardOrder(
        {
          status: "FILLED",
          exchangeOrderId: "historical-order",
          clientOrderId: "historical-client",
        },
        [],
      ),
    ).toBe(true);
  });
});

describe("native protection orphan grace", () => {
  it("does not cancel attached TP/SL while OKX position visibility catches up", () => {
    const now = new Date("2026-08-21T02:00:00.000Z").getTime();
    expect(
      isPastProtectionOrphanGrace(
        new Date("2026-08-21T01:59:51.000Z"),
        now,
      ),
    ).toBe(false);
    expect(
      isPastProtectionOrphanGrace(
        new Date("2026-08-21T01:57:59.000Z"),
        now,
      ),
    ).toBe(true);
  });
});
