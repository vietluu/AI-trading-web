import { describe, it, expect } from 'vitest';
import { calculateKeltnerChannels } from '../src/market-data/domain/indicators/keltner-channels';

describe('calculateKeltnerChannels', () => {
  it('returns undefined if insufficient data', () => {
    const closes = [1, 2, 3];
    const highs = [1, 2, 3];
    const lows = [1, 2, 3];
    expect(calculateKeltnerChannels(closes, highs, lows)).toBeUndefined();
  });

  it('calculates valid keltner channels', () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + i);
    const highs = Array.from({ length: 25 }, (_, i) => 105 + i);
    const lows = Array.from({ length: 25 }, (_, i) => 95 + i);
    
    const result = calculateKeltnerChannels(closes, highs, lows);
    expect(result).toBeDefined();
    if (result) {
      expect(result.upper).toBeGreaterThan(result.middle);
      expect(result.middle).toBeGreaterThan(result.lower);
    }
  });

  it('works with custom multiplier', () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + i);
    const highs = Array.from({ length: 25 }, (_, i) => 105 + i);
    const lows = Array.from({ length: 25 }, (_, i) => 95 + i);
    
    const result1 = calculateKeltnerChannels(closes, highs, lows, 20, 14, 1.5);
    const result2 = calculateKeltnerChannels(closes, highs, lows, 20, 14, 2.0);
    
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
    
    if (result1 && result2) {
      expect(result2.upper).toBeGreaterThan(result1.upper);
      expect(result2.lower).toBeLessThan(result1.lower);
      expect(result1.middle).toBeCloseTo(result2.middle);
    }
  });

  it('all-same-price makes upper=middle=lower', () => {
    const closes = Array.from({ length: 25 }, () => 100);
    const highs = Array.from({ length: 25 }, () => 100);
    const lows = Array.from({ length: 25 }, () => 100);
    
    const result = calculateKeltnerChannels(closes, highs, lows);
    expect(result).toBeDefined();
    if (result) {
      expect(result.upper).toBeCloseTo(100);
      expect(result.middle).toBeCloseTo(100);
      expect(result.lower).toBeCloseTo(100);
    }
  });
});
