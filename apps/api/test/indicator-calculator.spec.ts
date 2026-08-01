import { describe, expect, it } from "vitest";
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateBollingerBands,
  calculateVolumeChangePercent,
  calculatePriceChangePercent,
  calculateRollingHigh,
  calculateRollingLow,
  calculateVolatility,
  calculateAllIndicators,
  type CandleData,
} from "../src/market-data/domain/indicators/indicator-calculator";

describe("Technical Indicators", () => {
  describe("SMA", () => {
    it("returns undefined for insufficient data", () => {
      expect(calculateSMA([1, 2], 5)).toBeUndefined();
    });

    it("calculates SMA correctly", () => {
      const result = calculateSMA([10, 20, 30, 40, 50], 5);
      expect(result).toBeCloseTo(30, 8);
    });

    it("uses last N values", () => {
      const result = calculateSMA([5, 10, 20, 30, 40, 50], 5);
      expect(result).toBeCloseTo(30, 8);
    });
  });

  describe("EMA", () => {
    it("returns undefined for insufficient data", () => {
      expect(calculateEMA([1, 2], 5)).toBeUndefined();
    });

    it("calculates EMA correctly", () => {
      const values = [
        22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29,
        22.15, 22.39,
      ];
      const result = calculateEMA(values, 10);
      expect(result).toBeDefined();
      expect(result!).toBeCloseTo(22.2241, 2);
    });
  });

  describe("RSI", () => {
    it("returns undefined for insufficient data", () => {
      expect(calculateRSI([1, 2, 3], 14)).toBeUndefined();
    });

    it("returns 100 when all gains", () => {
      const allUp = Array.from({ length: 20 }, (_, i) => 10 + i);
      const result = calculateRSI(allUp, 14);
      expect(result).toBe(100);
    });

    it("calculates RSI within valid range", () => {
      const prices = [
        44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08,
        45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
      ];
      const result = calculateRSI(prices, 14);
      expect(result).toBeDefined();
      expect(result!).toBeGreaterThanOrEqual(0);
      expect(result!).toBeLessThanOrEqual(100);
    });
  });

  describe("MACD", () => {
    it("returns undefined for insufficient data", () => {
      expect(calculateMACD([1, 2, 3])).toBeUndefined();
    });

    it("calculates MACD with enough data", () => {
      const prices = Array.from(
        { length: 40 },
        (_, i) => 100 + Math.sin(i / 3) * 10,
      );
      const result = calculateMACD(prices);
      expect(result).toBeDefined();
      expect(result!.value).toBeDefined();
      expect(result!.signal).toBeDefined();
      expect(result!.histogram).toBeDefined();
      expect(Number(result!.histogram)).toBeCloseTo(
        Number(result!.value) - Number(result!.signal),
        6,
      );
    });
  });

  describe("ATR", () => {
    it("returns undefined for insufficient data", () => {
      const candles: CandleData[] = [
        { open: "10", high: "12", low: "9", close: "11", volume: "100" },
      ];
      expect(calculateATR(candles, 14)).toBeUndefined();
    });

    it("calculates ATR with valid data", () => {
      const candles: CandleData[] = Array.from({ length: 20 }, (_, i) => ({
        open: String(100 + i),
        high: String(102 + i),
        low: String(98 + i),
        close: String(101 + i),
        volume: "1000",
      }));
      const result = calculateATR(candles, 14);
      expect(result).toBeDefined();
      expect(result!).toBeGreaterThan(0);
    });
  });

  describe("Bollinger Bands", () => {
    const testCloses = [
      44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08,
      45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
    ];

    it("returns undefined for insufficient data", () => {
      expect(calculateBollingerBands([1, 2, 3], 20)).toBeUndefined();
    });

    it("middle band equals SMA", () => {
      const result = calculateBollingerBands(testCloses, 20, 2);
      expect(result).toBeDefined();
      const sma = calculateSMA(testCloses, 20);
      expect(Number(result!.middle)).toBeCloseTo(sma!, 6);
    });

    it("upper > middle > lower", () => {
      const result = calculateBollingerBands(testCloses, 20, 2);
      expect(result).toBeDefined();
      expect(Number(result!.upper)).toBeGreaterThan(Number(result!.middle));
      expect(Number(result!.middle)).toBeGreaterThan(Number(result!.lower));
    });
  });

  describe("Volume Change", () => {
    it("returns undefined with insufficient data", () => {
      expect(calculateVolumeChangePercent([100])).toBeUndefined();
    });

    it("calculates correctly", () => {
      expect(calculateVolumeChangePercent([100, 150])).toBeCloseTo(50, 8);
      expect(calculateVolumeChangePercent([200, 100])).toBeCloseTo(-50, 8);
    });
  });

  describe("Price Change", () => {
    it("returns undefined with insufficient data", () => {
      expect(calculatePriceChangePercent([100])).toBeUndefined();
    });

    it("calculates correctly", () => {
      expect(calculatePriceChangePercent([100, 110])).toBeCloseTo(10, 8);
    });
  });

  describe("Rolling High/Low", () => {
    it("returns undefined with insufficient data", () => {
      expect(calculateRollingHigh([1, 2], 5)).toBeUndefined();
      expect(calculateRollingLow([1, 2], 5)).toBeUndefined();
    });

    it("finds correct values", () => {
      const values = [10, 20, 30, 15, 25];
      expect(calculateRollingHigh(values, 5)).toBe(30);
      expect(calculateRollingLow(values, 5)).toBe(10);
    });
  });

  describe("Volatility", () => {
    it("returns undefined with insufficient data", () => {
      expect(calculateVolatility([100], 20)).toBeUndefined();
    });

    it("returns positive value for varying prices", () => {
      const prices = Array.from(
        { length: 25 },
        (_, i) => 100 + Math.sin(i) * 5,
      );
      const result = calculateVolatility(prices, 20);
      expect(result).toBeDefined();
      expect(result!).toBeGreaterThan(0);
    });
  });

  describe("calculateAllIndicators", () => {
    it("returns empty object for no candles", () => {
      expect(calculateAllIndicators([])).toEqual({});
    });

    it("calculates all available indicators with 250 candles", () => {
      const candles: CandleData[] = Array.from({ length: 250 }, (_, i) => ({
        open: String(100 + Math.sin(i / 10) * 20),
        high: String(105 + Math.sin(i / 10) * 20),
        low: String(95 + Math.sin(i / 10) * 20),
        close: String(102 + Math.sin(i / 10) * 20),
        volume: String(1000 + Math.sin(i / 5) * 500),
      }));
      const result = calculateAllIndicators(candles);

      expect(result.sma20).toBeDefined();
      expect(result.sma50).toBeDefined();
      expect(result.sma200).toBeDefined();
      expect(result.ema9).toBeDefined();
      expect(result.ema20).toBeDefined();
      expect(result.ema50).toBeDefined();
      expect(result.ema200).toBeDefined();
      expect(result.rsi14).toBeDefined();
      expect(result.macd).toBeDefined();
      expect(result.atr14).toBeDefined();
      expect(result.bollingerBands).toBeDefined();
      expect(result.volumeChangePercent).toBeDefined();
      expect(result.priceChangePercent).toBeDefined();
      expect(result.rollingHigh).toBeDefined();
      expect(result.rollingLow).toBeDefined();
      expect(result.volatility).toBeDefined();
    });

    it("returns partial results with limited data", () => {
      const candles: CandleData[] = Array.from({ length: 10 }, (_, i) => ({
        open: String(100 + i),
        high: String(102 + i),
        low: String(98 + i),
        close: String(101 + i),
        volume: String(1000 + i * 100),
      }));
      const result = calculateAllIndicators(candles);

      expect(result.ema9).toBeDefined();
      expect(result.sma20).toBeUndefined();
      expect(result.sma50).toBeUndefined();
      expect(result.sma200).toBeUndefined();
    });
  });
});
