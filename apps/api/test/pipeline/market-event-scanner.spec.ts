import { describe, expect, it, vi } from "vitest";
import { MarketEventScannerService } from "../../src/modules/pipeline/application/market-event-scanner.service";

function redisMock() {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    setWithTtl: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    setNx: vi.fn((key: string, value: string) => {
      if (key.includes(":slot:")) return Promise.resolve(true);
      if (values.has(key)) return Promise.resolve(false);
      values.set(key, value);
      return Promise.resolve(true);
    }),
  };
}

function scannerSnapshot(now: Date, price = "101") {
  const activeCandle = {
    provider: "OKX_FUTURES",
    symbol: "ZRO-USDT",
    interval: "5m",
    openTime: new Date(now.getTime() - 60_000),
    closeTime: new Date(now.getTime() + 4 * 60_000),
    open: "100",
    high: price,
    low: "99.8",
    close: price,
    volume: "1000",
    isClosed: false,
  };
  const indicator = {
    provider: "OKX_FUTURES",
    symbol: "ZRO-USDT",
    interval: "5m",
    candleOpenTime: new Date(now.getTime() - 5 * 60_000),
    candleCloseTime: new Date(now.getTime() - 60_000),
    status: "CLOSED",
    values: {
      atr14: "1",
      rsi14: "60",
      ema20: "99",
      ema50: "98",
      macd: { value: "1", signal: "0.5", histogram: "0.5" },
      rollingHigh: "100.8",
      rollingLow: "97",
      priceChangePercent: "0.7",
      volumeChangePercent: "40",
    },
    calculatedAt: now,
    calculationVersion: "test",
  };
  return { activeCandle, indicator };
}

describe("MarketEventScannerService", () => {
  const input = {
    userId: "user-1",
    provider: "OKX_FUTURES",
    symbol: "ZRO-USDT",
    strategyIds: ["trend", "breakout"],
  };

  it("deduplicates the 15m anchor when the closed-candle fingerprint is unchanged", async () => {
    const now = new Date("2026-08-19T01:15:00Z");
    const redis = redisMock();
    const { indicator } = scannerSnapshot(now);
    indicator.interval = "15m";
    const scanner = new MarketEventScannerService(
      {} as never,
      { getIndicatorSnapshot: vi.fn().mockResolvedValue(indicator) } as never,
      redis as never,
    );

    const first = await scanner.reserveAnchor({ ...input, provider: input.provider as never });
    const duplicate = await scanner.reserveAnchor({ ...input, provider: input.provider as never });

    expect(first).toMatchObject({ run: true });
    expect(duplicate).toEqual({ run: false, fingerprint: first.fingerprint });
  });

  it("requires two scans and triggers only once for the same 5m fingerprint", async () => {
    const now = new Date("2026-08-19T01:15:00Z");
    const redis = redisMock();
    const { activeCandle, indicator } = scannerSnapshot(now);
    const scanner = new MarketEventScannerService(
      {
        getTicker: vi.fn().mockResolvedValue({
          provider: "OKX_FUTURES",
          symbol: "ZRO-USDT",
          lastPrice: "101",
          timestamp: now,
        }),
        getCandle: vi.fn().mockResolvedValue(activeCandle),
      } as never,
      {
        getIndicatorSnapshot: vi.fn().mockResolvedValue(indicator),
        getHistoricalCandles: vi.fn().mockResolvedValue([]),
      } as never,
      redis as never,
    );

    const first = await scanner.scan({ ...input, provider: input.provider as never, now });
    const second = await scanner.scan({
      ...input,
      provider: input.provider as never,
      now: new Date(now.getTime() + 60_000),
    });
    const duplicate = await scanner.scan({
      ...input,
      provider: input.provider as never,
      now: new Date(now.getTime() + 120_000),
    });

    expect(first).toMatchObject({ triggered: false, reason: "AWAITING_CONFIRMATION" });
    expect(second).toMatchObject({
      triggered: true,
      reason: "EVENT_CONFIRMED",
      evidence: {
        direction: "BULLISH",
        confirmationCount: 2,
      },
    });
    expect(duplicate).toMatchObject({ triggered: false, reason: "DUPLICATE_FINGERPRINT" });
  });

  it("does not call the AI pipeline for unchanged non-material market data", async () => {
    const now = new Date("2026-08-19T01:15:00Z");
    const redis = redisMock();
    const { activeCandle, indicator } = scannerSnapshot(now, "100.1");
    indicator.values.rollingHigh = "102";
    indicator.values.priceChangePercent = "0.1";
    indicator.values.volumeChangePercent = "2";
    const scanner = new MarketEventScannerService(
      {
        getTicker: vi.fn().mockResolvedValue({
          provider: "OKX_FUTURES",
          symbol: "ZRO-USDT",
          lastPrice: "100.1",
          timestamp: now,
        }),
        getCandle: vi.fn().mockResolvedValue(activeCandle),
      } as never,
      {
        getIndicatorSnapshot: vi.fn().mockResolvedValue(indicator),
        getHistoricalCandles: vi.fn().mockResolvedValue([]),
      } as never,
      redis as never,
    );

    await expect(scanner.scan({ ...input, provider: input.provider as never, now }))
      .resolves.toMatchObject({ triggered: false, reason: "NO_MATERIAL_EVENT" });
  });
});
