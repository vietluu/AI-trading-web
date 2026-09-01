import { describe, expect, it } from 'vitest';
import { deterministicMarketAnalysis } from '../src/modules/agents/domain/analysis/deterministic-core-analysis';

const makeCandlesWithSpike = (avgVol: number | string, latestVol: number | string) =>
  Array.from({ length: 22 }, (_, i) => ({
    close: 50000 + i * 10,
    high: 50100 + i * 10,
    low: 49900 + i * 10,
    volume: i === 21 ? latestVol : avgVol,
  }));

describe('deterministicMarketAnalysis - volumeProfile', () => {
  it('should set volumeProfile=true when latest candle volume > 1.5x average', () => {
    const candles = makeCandlesWithSpike(1000, 2000); // 2000 > 1000*1.5
    const toolData = {
      'market.ticker.get': { last: '50220', volume24h: '50000' },
      'market.indicators.get': { ema20: 50100, ema50: 49500, rsi: 55, atr: 300 },
      'market.candles.list': { candles },
    };
    const result = deterministicMarketAnalysis(toolData, Object.keys(toolData));
    expect(result?.liquidity?.volumeProfile).toBe(true);
  });

  it('should set volumeProfile=false when volume is normal', () => {
    const candles = makeCandlesWithSpike(1000, 1100); // 1100 < 1500
    const toolData = {
      'market.ticker.get': { last: '50220', volume24h: '50000' },
      'market.indicators.get': { ema20: 50100, ema50: 49500, rsi: 55, atr: 300 },
      'market.candles.list': { candles },
    };
    const result = deterministicMarketAnalysis(toolData, Object.keys(toolData));
    expect(result?.liquidity?.volumeProfile).toBe(false);
  });

  it('should handle string volumes properly', () => {
    const candles = makeCandlesWithSpike('1000', '2500');
    const toolData = {
      'market.ticker.get': { price: '50220' },
      'market.indicators.get': { ema20: 50100, ema50: 49500, rsi: 55, atr: 300 },
      'market.candles.list': { candles },
    };
    const result = deterministicMarketAnalysis(toolData, Object.keys(toolData));
    expect(result?.liquidity?.volumeProfile).toBe(true);
  });

  it('should set volumeProfile=false when insufficient candle history is provided', () => {
    const toolData = {
      'market.ticker.get': { price: '50220' },
      'market.indicators.get': { ema20: 50100, ema50: 49500, rsi: 55, atr: 300 },
      'market.candles.list': {
        candles: [{ close: 50000, high: 50100, low: 49900, volume: 2000 }],
      },
    };
    const result = deterministicMarketAnalysis(toolData, Object.keys(toolData));
    expect(result?.liquidity?.volumeProfile).toBe(false);
  });
});
