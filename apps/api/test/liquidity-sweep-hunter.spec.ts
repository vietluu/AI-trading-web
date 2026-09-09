import { describe, it, expect } from 'vitest';
import { identifyLiquidityZones, detectLiquiditySweep, CandleInput } from '../src/modules/agents/domain/analysis/liquidity-sweep-hunter';

describe('Liquidity Sweep Hunter', () => {
  it('Empty/single candle = empty zones', () => {
    expect(identifyLiquidityZones([])).toEqual([]);
    expect(identifyLiquidityZones([{ open: 1, high: 2, low: 1, close: 1.5, volume: 100 }])).toEqual([]);
  });

  it('Identifies swing highs/lows', () => {
    const candles: CandleInput[] = Array.from({ length: 20 }, (_, i) => ({
      open: 100,
      high: i === 10 ? 150 : 100,
      low: i === 15 ? 50 : 100,
      close: 100,
      volume: 100
    }));

    const zones = identifyLiquidityZones(candles, 100, 3);
    
    const swingHigh = zones.find(z => z.type === 'SWING_HIGH');
    const swingLow = zones.find(z => z.type === 'SWING_LOW');
    
    expect(swingHigh).toBeDefined();
    expect(swingHigh?.price).toBe(150);
    
    expect(swingLow).toBeDefined();
    expect(swingLow?.price).toBe(50);
  });

  it('Equal highs detection', () => {
    const candles: CandleInput[] = Array.from({ length: 30 }, (_, i) => {
      let high = 100;
      if (i === 10) high = 150;
      if (i === 20) high = 150.05; // Within 0.1% of 150 (diff = 0.05 / 150.05 = 0.00033)
      return { open: 100, high, low: 100, close: 100, volume: 100 };
    });

    const zones = identifyLiquidityZones(candles, 100, 3);
    const equalHighs = zones.find(z => z.type === 'EQUAL_HIGHS');
    
    expect(equalHighs).toBeDefined();
    expect(equalHighs?.touchCount).toBe(2);
    expect(equalHighs?.price).toBeCloseTo(150.025);
  });

  it('Detects bullish and bearish sweeps', () => {
    const zones = [
      { price: 150, type: 'SWING_HIGH' as const, strength: 60, touchCount: 1, lastTestedIndex: 10 },
      { price: 50, type: 'SWING_LOW' as const, strength: 60, touchCount: 1, lastTestedIndex: 15 }
    ];

    // Bearish sweep: candle goes above 150, but closes below 150
    const bearishCandles: CandleInput[] = [
      { open: 100, high: 100, low: 100, close: 100, volume: 100 },
      { open: 140, high: 155, low: 130, close: 145, volume: 100 }
    ];
    
    const bearishSignal = detectLiquiditySweep(bearishCandles, zones);
    expect(bearishSignal).toBeDefined();
    expect(bearishSignal?.direction).toBe('BEARISH_SWEEP');

    // Bullish sweep: candle goes below 50, but closes above 50
    const bullishCandles: CandleInput[] = [
      { open: 100, high: 100, low: 100, close: 100, volume: 100 },
      { open: 60, high: 70, low: 45, close: 55, volume: 100 }
    ];

    const bullishSignal = detectLiquiditySweep(bullishCandles, zones);
    expect(bullishSignal).toBeDefined();
    expect(bullishSignal?.direction).toBe('BULLISH_SWEEP');
  });

  it('Volume confirmation flag', () => {
    const zones = [
      { price: 150, type: 'SWING_HIGH' as const, strength: 60, touchCount: 1, lastTestedIndex: 10 }
    ];

    const candles: CandleInput[] = Array.from({ length: 21 }, (_, i) => ({
      open: 100,
      high: i === 20 ? 155 : 100,
      low: 100,
      close: i === 20 ? 145 : 100,
      volume: i === 20 ? 500 : 100 // 500 > 1.5 * 100
    }));

    const signal = detectLiquiditySweep(candles, zones);
    expect(signal?.volumeConfirmation).toBe(true);
    expect(signal?.confidence).toBeGreaterThanOrEqual(90); // 40 + 20(reclaimed) + 20(vol) + 10(strength>50) = 90
  });

  it('Returns null when no sweep', () => {
    const zones = [
      { price: 150, type: 'SWING_HIGH' as const, strength: 60, touchCount: 1, lastTestedIndex: 10 }
    ];

    const candles: CandleInput[] = [
      { open: 100, high: 110, low: 90, close: 105, volume: 100 } // Doesn't reach 150
    ];

    expect(detectLiquiditySweep(candles, zones)).toBeNull();
  });

  it('Returns highest confidence signal', () => {
    const zones = [
      { price: 150, type: 'SWING_HIGH' as const, strength: 40, touchCount: 1, lastTestedIndex: 10 },
      { price: 151, type: 'EQUAL_HIGHS' as const, strength: 80, touchCount: 2, lastTestedIndex: 12 }
    ];

    const candles: CandleInput[] = [
      { open: 100, high: 155, low: 100, close: 145, volume: 100 }
    ];

    const signal = detectLiquiditySweep(candles, zones);
    // Should pick the 151 zone because strength > 50 gives +10 confidence
    expect(signal?.sweepZone.price).toBe(151);
  });
});
