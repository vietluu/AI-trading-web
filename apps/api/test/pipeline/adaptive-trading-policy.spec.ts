import { describe, expect, it } from 'vitest';
import {
  adaptiveTradingPolicy,
  parseSpreadBps,
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
});
