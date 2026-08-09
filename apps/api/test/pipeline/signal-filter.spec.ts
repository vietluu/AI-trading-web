import { describe, expect, it } from "vitest";
import { SignalFilterService } from "../../src/modules/pipeline/application/signal-filter.service";

describe("signal filter", () => {
  const service = new SignalFilterService();

  it("skips sideways low-volatility regimes before any AI analysis", () => {
    const result = service.evaluate({
      symbol: "MEME-USDT",
      rsi: 50,
      atr: 20,
      volumeChangePercent: 0.4,
      ema20: 100,
      ema50: 101,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("NO_TRADE_ZONE");
  });

  it("skips when ATR is below the volatility threshold", () => {
    const result = service.evaluate({
      rsi: 62,
      atr: 15,
      volumeChangePercent: 2.8,
      ema20: 100,
      ema50: 98,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("LOW_ATR");
  });

  it("allows trending conditions with aligned EMA and sufficient ATR", () => {
    const result = service.evaluate({
      rsi: 62,
      atr: 80,
      volumeChangePercent: 2.8,
      ema20: 110,
      ema50: 104,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("allows a liquid quantitative range without requiring EMA trend", () => {
    const result = service.evaluate({
      symbol: "BTC-USDT",
      timeframe: "15m",
      price: 100,
      rsi: 42,
      atr: 0.2,
      volumeChangePercent: 0.5,
      ema20: 100,
      ema50: 100,
      adx: 15,
      efficiencyRatio: 0.2,
    });

    expect(result).toMatchObject({ allowed: true, preliminaryRegime: "RANGING" });
  });

  it("keeps neutral low-volume ranges in the no-trade zone", () => {
    const result = service.evaluate({
      symbol: "BTC-USDT",
      timeframe: "15m",
      price: 100,
      rsi: 50,
      atr: 0.2,
      volumeChangePercent: 0.1,
      ema20: 100,
      ema50: 100,
      adx: 15,
      efficiencyRatio: 0.2,
    });

    expect(result).toMatchObject({
      allowed: false,
      reason: "NO_TRADE_ZONE",
      preliminaryRegime: "RANGING",
    });
  });

  it("fails closed when indicator data is unavailable", () => {
    const result = service.evaluate({});

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("INSUFFICIENT_INDICATORS");
  });
});
