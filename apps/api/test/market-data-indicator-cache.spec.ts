import { describe, expect, it, vi } from "vitest";
import { ExchangeInterval, ExchangeProvider } from "../src/exchange/domain/exchange.types";
import { IndicatorStatus } from "../src/market-data/domain/market-data.enums";
import type { IndicatorSnapshot } from "../src/market-data/domain/market-data.types";
import { MarketDataService } from "../src/market-data/application/market-data.service";

describe("MarketDataService indicator cache recovery", () => {
  it("restores an expired Redis indicator from PostgreSQL", async () => {
    const snapshot: IndicatorSnapshot = {
      provider: ExchangeProvider.OKX_FUTURES,
      symbol: "ZRO-USDT",
      interval: ExchangeInterval.FIFTEEN_MINUTES,
      candleOpenTime: new Date("2026-08-10T04:00:00Z"),
      candleCloseTime: new Date("2026-08-10T04:14:59.999Z"),
      status: IndicatorStatus.CLOSED,
      values: { rsi14: "67.29", atr14: "0.00540733" },
      calculatedAt: new Date("2026-08-10T04:15:35Z"),
      calculationVersion: 1,
    };
    const cache = {
      getIndicator: vi.fn().mockResolvedValue(null),
      setIndicator: vi.fn().mockResolvedValue(undefined),
    };
    const repository = {
      getLatestIndicatorSnapshot: vi.fn().mockResolvedValue(snapshot),
    };
    const exchanges = { klines: vi.fn() };
    const service = new MarketDataService(
      {} as never,
      {} as never,
      cache as never,
      repository as never,
      exchanges as never,
    );

    await expect(service.getIndicatorSnapshot(
      ExchangeProvider.OKX_FUTURES,
      "ZRO-USDT",
      ExchangeInterval.FIFTEEN_MINUTES,
    )).resolves.toEqual(snapshot);
    expect(cache.setIndicator).toHaveBeenCalledWith(
      ExchangeProvider.OKX_FUTURES,
      "ZRO-USDT",
      ExchangeInterval.FIFTEEN_MINUTES,
      snapshot,
    );
    expect(exchanges.klines).not.toHaveBeenCalled();
  });
});
