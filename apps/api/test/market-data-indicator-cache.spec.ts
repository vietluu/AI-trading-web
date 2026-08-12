import { describe, expect, it, vi } from "vitest";
import { ExchangeInterval, ExchangeProvider } from "../src/exchange/domain/exchange.types";
import { IndicatorStatus } from "../src/market-data/domain/market-data.enums";
import type { IndicatorSnapshot } from "../src/market-data/domain/market-data.types";
import { MarketDataService } from "../src/market-data/application/market-data.service";

describe("MarketDataService indicator cache recovery", () => {
  it("restores an expired Redis indicator from PostgreSQL", async () => {
    const now = Date.now();
    const snapshot: IndicatorSnapshot = {
      provider: ExchangeProvider.OKX_FUTURES,
      symbol: "ZRO-USDT",
      interval: ExchangeInterval.FIFTEEN_MINUTES,
      candleOpenTime: new Date(now - 15 * 60_000),
      candleCloseTime: new Date(now - 1_000),
      status: IndicatorStatus.CLOSED,
      values: { rsi14: "67.29", atr14: "0.00540733" },
      calculatedAt: new Date(now),
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

  it("refreshes stale stored candles from the exchange", async () => {
    const stale = {
      provider: ExchangeProvider.OKX_FUTURES,
      symbol: "OKB-USDT",
      interval: ExchangeInterval.FIFTEEN_MINUTES,
      openTime: new Date(Date.now() - 24 * 60 * 60_000),
      closeTime: new Date(Date.now() - 24 * 60 * 60_000 + 15 * 60_000 - 1),
      open: "95",
      high: "96",
      low: "94",
      close: "95.5",
      volume: "100",
      isClosed: true,
    };
    const fresh = {
      ...stale,
      openTime: new Date(Date.now() - 15 * 60_000),
      closeTime: new Date(Date.now() - 1_000),
      close: "99",
    };
    const repository = {
      getCandles: vi.fn().mockResolvedValue([stale]),
      upsertCandleBatch: vi.fn().mockResolvedValue(undefined),
      getClosedCandles: vi.fn().mockResolvedValue([]),
    };
    const exchanges = { klines: vi.fn().mockResolvedValue([fresh]) };
    const service = new MarketDataService(
      {} as never,
      {} as never,
      {} as never,
      repository as never,
      exchanges as never,
    );

    const result = await service.getHistoricalCandles({
      provider: ExchangeProvider.OKX_FUTURES,
      symbol: "OKB-USDT",
      interval: ExchangeInterval.FIFTEEN_MINUTES,
      limit: 1,
    });

    expect(result).toEqual([fresh]);
    expect(exchanges.klines).toHaveBeenCalledTimes(1);
    expect(repository.upsertCandleBatch).toHaveBeenCalledWith([fresh]);
  });
});
