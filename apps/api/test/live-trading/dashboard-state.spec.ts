import { describe, expect, it } from "vitest";

import { ExchangeProvider, type ExchangeOrder } from "../../src/exchange/domain/exchange.types";
import { isAuthoritativeDashboardOrder } from "../../src/modules/live-trading/application/live-trading.service";

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
