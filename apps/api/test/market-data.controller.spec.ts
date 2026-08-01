import { describe, expect, it, vi } from "vitest";
import { MarketDataController } from "../src/market-data/presentation/market-data.controller";
import { IndicatorStatus } from "../src/market-data/domain/market-data.enums";
import { ExchangeProvider, ExchangeInterval } from "../src/exchange/domain/exchange.types";

describe("MarketDataController", () => {
  it("returns an insufficient-data snapshot instead of throwing when no indicator snapshot exists", async () => {
    const controller = new MarketDataController(
      {} as never,
      {} as never,
      {
        getConfig: () => ({ providers: [ExchangeProvider.BINANCE_FUTURES], symbols: ["BTC-USDT"], intervals: [ExchangeInterval.ONE_HOUR], enabled: true }),
      } as never,
      {
        getIndicatorSnapshot: vi.fn().mockResolvedValue(null),
      } as never,
    );

    const response = await controller.getIndicators(
      ExchangeProvider.BINANCE_FUTURES,
      "BTC-USDT",
      ExchangeInterval.ONE_HOUR,
    );

    expect(response).toMatchObject({
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: "BTC-USDT",
      interval: ExchangeInterval.ONE_HOUR,
      status: IndicatorStatus.INSUFFICIENT_DATA,
      values: {},
    });
  });
});
