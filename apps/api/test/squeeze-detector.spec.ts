import { describe, it, expect } from 'vitest';
import { detectSqueeze } from '../src/market-data/domain/indicators/squeeze-detector';

describe('detectSqueeze', () => {
  it('returns default if insufficient data', () => {
    const closes = [1, 2, 3];
    const highs = [1, 2, 3];
    const lows = [1, 2, 3];
    const volumes = [100, 100, 100];
    const result = detectSqueeze(closes, highs, lows, volumes);
    expect(result.isSqueezing).toBe(false);
    expect(result.squeezeIntensity).toBe(0);
    expect(result.breakoutProbability).toBe(0);
  });

  it('detects squeeze correctly', () => {
    // Generate data that causes a squeeze (tight bollinger bands, loose keltner channels)
    // We can simulate this by making price move very little
    const closes = Array.from({ length: 50 }, () => 100);
    const highs = Array.from({ length: 50 }, () => 102); // ATR = 2
    const lows = Array.from({ length: 50 }, () => 98); // ATR = 2
    const volumes = Array.from({ length: 50 }, () => 100);
    
    // With 0 price movement, stddev is 0, so BB is very tight (width 0)
    // ATR is 4, so KC has width > 0. Thus BB is inside KC.
    const result = detectSqueeze(closes, highs, lows, volumes, "0.5");
    expect(result.isSqueezing).toBe(true);
    expect(result.squeezeIntensity).toBe(100); // 1 - 0/kcWidth = 1 * 100
    expect(result.momentumDirection).toBe('BULLISH');
  });

  it('detects no squeeze correctly', () => {
    // Generate data that causes NO squeeze (wide bollinger bands, tight keltner channels)
    // A strong trend will increase stddev (BB) but keep ATR (KC) steady if step is small
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i * 10);
    const highs = Array.from({ length: 50 }, (_, i) => 100 + i * 10 + 2);
    const lows = Array.from({ length: 50 }, (_, i) => 100 + i * 10 - 2);
    const volumes = Array.from({ length: 50 }, () => 100);
    
    const result = detectSqueeze(closes, highs, lows, volumes, "-0.5");
    expect(result.isSqueezing).toBe(false);
    expect(result.squeezeIntensity).toBe(0);
    expect(result.momentumDirection).toBe('BEARISH');
  });
});
