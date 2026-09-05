import { describe, expect, it } from 'vitest';
import {
  adaptiveTradingPolicy,
  parseSpreadBps,
  preferredTradePlanAtr,
} from '../../src/modules/pipeline/domain/adaptive-trading-policy';

describe('adaptive trading policy', () => {
  it('requires more edge and lower risk for volatile long-tail assets', () => {
    const major = adaptiveTradingPolicy({
      symbol: 'BTC-USDT',
      provider: 'BINANCE_FUTURES',
      timeframe: '15m',
      regime: 'TRENDING',
      spreadBps: 2,
    });
    const longTail = adaptiveTradingPolicy({
      symbol: 'MEME-USDT',
      provider: 'OKX_FUTURES',
      timeframe: '15m',
      regime: 'HIGH_VOLATILITY',
      spreadBps: 20,
    });

    expect(longTail.minExpectedValue).toBeGreaterThan(major.minExpectedValue);
    expect(longTail.minProfitFactor).toBeGreaterThan(major.minProfitFactor);
    expect(longTail.maxRiskScore).toBeLessThan(major.maxRiskScore);
    expect(longTail.minAtrPercent).toBeGreaterThan(major.minAtrPercent);
  });

  it('normalizes percentage and absolute spread to basis points', () => {
    expect(parseSpreadBps('0.05%')).toBe(5);
    expect(parseSpreadBps('2', 10_000)).toBe(2);
  });

  it('prefers deterministic indicator ATR over the agent representation', () => {
    expect(preferredTradePlanAtr('0.42', '0.8 USDT')).toBe(0.42);
    expect(preferredTradePlanAtr(undefined, '0.8 USDT')).toBe(0.8);
    expect(preferredTradePlanAtr('0', 'not available')).toBeUndefined();
  });

  it('provides tiered dynamic cold-start thresholds, cost multipliers and RSI boundaries', () => {
    const btcTrending = adaptiveTradingPolicy({
      symbol: 'BTC-USDT',
      regime: 'TRENDING',
    });
    const altRanging = adaptiveTradingPolicy({
      symbol: 'SOL-USDT',
      regime: 'RANGING',
    });
    const memeHighVol = adaptiveTradingPolicy({
      symbol: 'PEPE-USDT',
      regime: 'HIGH_VOLATILITY',
    });

    // Liquidity tier cost multipliers
    expect(btcTrending.executionCostMultiplier).toBe(1);
    expect(altRanging.executionCostMultiplier).toBe(1.5);
    expect(memeHighVol.executionCostMultiplier).toBe(2.5);

    // Tiered cold-start conviction requirements
    expect(btcTrending.minColdStartConfidence).toBeLessThan(altRanging.minColdStartConfidence);
    expect(altRanging.minColdStartConfidence).toBeLessThan(memeHighVol.minColdStartConfidence);
    expect(btcTrending.minColdStartOpportunity).toBeLessThan(memeHighVol.minColdStartOpportunity);

    // Regime-based dynamic RSI boundaries
    expect(btcTrending.maxRsiLong).toBe(85); // Parabolic trend allowed
    expect(altRanging.maxRsiLong).toBe(75); // Sideway tightened
    expect(memeHighVol.maxRsiLong).toBe(72);
    expect(btcTrending.minRsiShort).toBe(15);
    expect(altRanging.minRsiShort).toBe(25);
  });
});
