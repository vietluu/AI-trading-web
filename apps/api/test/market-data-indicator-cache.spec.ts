import { describe, expect, it, vi } from "vitest";
import { ExchangeInterval, ExchangeProvider } from "../src/exchange/domain/exchange.types";
import { IndicatorStatus } from "../src/market-data/domain/market-data.enums";
import type { IndicatorSnapshot } from "../src/market-data/domain/market-data.types";
import { MarketDataService } from "../src/market-data/application/market-data.service";

describe("MarketDataService indicator cache recovery", () => {
  it('refreshes the previous closed bucket after a new candle has closed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T14:51:00Z'));
    try {
      let snapshot: IndicatorSnapshot = {
        provider: ExchangeProvider.OKX_FUTURES, symbol: 'ZRO-USDT', interval: ExchangeInterval.FIFTEEN_MINUTES,
        candleOpenTime: new Date('2026-09-15T14:15:00Z'), candleCloseTime: new Date('2026-09-15T14:29:59.999Z'),
        status: IndicatorStatus.CLOSED, values: { rsi14: '42.07' }, calculatedAt: new Date(), calculationVersion: 2,
      };
      const history = Array.from({ length: 250 }, (_, index) => ({
        provider: snapshot.provider, symbol: snapshot.symbol, interval: snapshot.interval,
        openTime: new Date(Date.parse('2026-09-15T14:30:00Z') - (249-index)*900000),
        closeTime: new Date(Date.parse('2026-09-15T14:44:59.999Z') - (249-index)*900000),
        open: String(2-index*0.002), high: String(2.01-index*0.002),
        low: String(1.99-index*0.002), close: String(2-index*0.002), volume: '100', isClosed: true,
      }));
      const cache = { getIndicator: vi.fn(() => Promise.resolve(snapshot)),
        setIndicator: vi.fn((_provider: unknown, _symbol: unknown, _interval: unknown, value: IndicatorSnapshot) => {
          snapshot = value; return Promise.resolve();
        }) };
      const repository = { getLatestIndicatorSnapshot: vi.fn(() => Promise.resolve(snapshot)),
        getCandles: vi.fn().mockResolvedValue(history.map(c => ({ ...c, closeTime: new Date(c.closeTime.getTime()-900000) }))),
        getClosedCandles: vi.fn().mockResolvedValue(history), upsertCandleBatch: vi.fn(), upsertIndicatorSnapshot: vi.fn() };
      const exchanges = { klines: vi.fn().mockResolvedValue(history) };
      const service = new MarketDataService({} as never, {} as never, cache as never, repository as never, exchanges as never);
      const result = await service.getIndicatorSnapshot(snapshot.provider, snapshot.symbol, snapshot.interval);
      expect(result?.candleCloseTime).toEqual(new Date('2026-09-15T14:44:59.999Z'));
      expect(exchanges.klines).toHaveBeenCalledTimes(1);
      expect(repository.getClosedCandles).toHaveBeenCalledWith(expect.objectContaining({
        beforeTime: new Date('2026-09-15T14:44:59.999Z'),
      }));
    } finally { vi.useRealTimers(); }
  });
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

  it("handles string timestamps in cached indicator snapshots without throwing", async () => {
    const now = Date.now();
    const serializedSnapshot = {
      provider: ExchangeProvider.OKX_FUTURES,
      symbol: "SOL-USDT",
      interval: ExchangeInterval.FIFTEEN_MINUTES,
      candleOpenTime: new Date(now - 15 * 60_000).toISOString(),
      candleCloseTime: new Date(now - 1_000).toISOString(),
      status: IndicatorStatus.CLOSED,
      values: { rsi14: "55.0" },
      calculatedAt: new Date(now).toISOString(),
      calculationVersion: 1,
    };
    const cache = {
      getIndicator: vi.fn().mockResolvedValue(serializedSnapshot),
      setIndicator: vi.fn(),
    };
    const service = new MarketDataService(
      {} as never,
      {} as never,
      cache as never,
      {} as never,
      {} as never,
    );

    const snapshot = await service.getIndicatorSnapshot(
      ExchangeProvider.OKX_FUTURES,
      "SOL-USDT",
      ExchangeInterval.FIFTEEN_MINUTES,
    );
    expect(snapshot).not.toBeNull();
  });

  it("MarketRedisCacheService revives date fields from Redis JSON", async () => {
    const rawJson = JSON.stringify({
      provider: "OKX_FUTURES",
      symbol: "SOL-USDT",
      interval: "15m",
      candleOpenTime: "2026-09-02T20:00:00.000Z",
      candleCloseTime: "2026-09-02T20:14:59.999Z",
      status: "CLOSED",
      values: { rsi14: "55.0" },
      calculatedAt: "2026-09-02T20:15:00.000Z",
      calculationVersion: 1,
    });
    const redisService = {
      get: vi.fn().mockResolvedValue(rawJson),
      setWithTtl: vi.fn(),
    };
    const { MarketRedisCacheService } = await import(
      "../src/market-data/infrastructure/redis/market-redis-cache.service"
    );
    const cacheService = new MarketRedisCacheService(redisService as never);
    const indicator = await cacheService.getIndicator(
      ExchangeProvider.OKX_FUTURES,
      "SOL-USDT",
      "15m",
    );

    expect(indicator).not.toBeNull();
    expect(indicator!.candleCloseTime).toBeInstanceOf(Date);
    expect(indicator!.candleCloseTime.getTime()).toBe(new Date("2026-09-02T20:14:59.999Z").getTime());
    expect(indicator!.candleOpenTime).toBeInstanceOf(Date);
    expect(indicator!.calculatedAt).toBeInstanceOf(Date);
  });
});

