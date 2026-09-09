export interface CandleInput {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ZoneType = 'SWING_HIGH' | 'SWING_LOW' | 'EQUAL_HIGHS' | 'EQUAL_LOWS';
export type SweepDirection = 'BULLISH_SWEEP' | 'BEARISH_SWEEP';

export interface LiquidityZone {
  price: number;
  type: ZoneType;
  strength: number;
  touchCount: number;
  lastTestedIndex: number;
}

export interface SweepSignal {
  detected: boolean;
  direction: SweepDirection;
  sweepZone: LiquidityZone;
  sweepDepth: number;
  reclaimed: boolean;
  volumeConfirmation: boolean;
  confidence: number;
}

export function identifyLiquidityZones(
  candles: CandleInput[],
  lookback: number = 100,
  pivotStrength: number = 5
): LiquidityZone[] {
  if (candles.length < 2) return [];

  const startIndex = Math.max(0, candles.length - lookback);

  const swingHighs: { price: number; index: number }[] = [];
  const swingLows: { price: number; index: number }[] = [];

  for (let i = startIndex; i < candles.length; i++) {
    const currentHigh = candles[i]!.high;
    const currentLow = candles[i]!.low;
    let isSwingHigh = true;
    let isSwingLow = true;

    // Check left
    for (let j = Math.max(0, i - pivotStrength); j < i; j++) {
      if (candles[j]!.high >= currentHigh) isSwingHigh = false;
      if (candles[j]!.low <= currentLow) isSwingLow = false;
    }

    // Check right
    for (let j = i + 1; j <= Math.min(candles.length - 1, i + pivotStrength); j++) {
      if (candles[j]!.high >= currentHigh) isSwingHigh = false;
      if (candles[j]!.low <= currentLow) isSwingLow = false;
    }

    if (isSwingHigh) {
      swingHighs.push({ price: currentHigh, index: i });
    }
    if (isSwingLow) {
      swingLows.push({ price: currentLow, index: i });
    }
  }

  // Cluster highs
  const highZones: LiquidityZone[] = [];
  const processedHighs = new Set<number>();

  for (let i = 0; i < swingHighs.length; i++) {
    if (processedHighs.has(i)) continue;
    
    let sumPrice = swingHighs[i]!.price;
    let touchCount = 1;
    let lastTestedIndex = swingHighs[i]!.index;
    
    for (let j = i + 1; j < swingHighs.length; j++) {
      if (processedHighs.has(j)) continue;
      
      const p1 = sumPrice / touchCount;
      const p2 = swingHighs[j]!.price;
      const diff = Math.abs(p1 - p2) / Math.max(p1, p2);
      
      if (diff < 0.001) {
        sumPrice += p2;
        touchCount++;
        lastTestedIndex = Math.max(lastTestedIndex, swingHighs[j]!.index);
        processedHighs.add(j);
      }
    }
    
    const avgPrice = sumPrice / touchCount;
    const type = touchCount > 1 ? 'EQUAL_HIGHS' : 'SWING_HIGH';
    
    // Strength: min(100, touchCount * 20 + max(0, 30 - (candles.length - lastTestedIndex)))
    const strength = Math.min(100, touchCount * 20 + Math.max(0, 30 - (candles.length - lastTestedIndex)));
    
    highZones.push({
      price: avgPrice,
      type,
      strength,
      touchCount,
      lastTestedIndex
    });
  }

  // Cluster lows
  const lowZones: LiquidityZone[] = [];
  const processedLows = new Set<number>();

  for (let i = 0; i < swingLows.length; i++) {
    if (processedLows.has(i)) continue;
    
    let sumPrice = swingLows[i]!.price;
    let touchCount = 1;
    let lastTestedIndex = swingLows[i]!.index;
    
    for (let j = i + 1; j < swingLows.length; j++) {
      if (processedLows.has(j)) continue;
      
      const p1 = sumPrice / touchCount;
      const p2 = swingLows[j]!.price;
      const diff = Math.abs(p1 - p2) / Math.max(p1, p2);
      
      if (diff < 0.001) {
        sumPrice += p2;
        touchCount++;
        lastTestedIndex = Math.max(lastTestedIndex, swingLows[j]!.index);
        processedLows.add(j);
      }
    }
    
    const avgPrice = sumPrice / touchCount;
    const type = touchCount > 1 ? 'EQUAL_LOWS' : 'SWING_LOW';
    
    const strength = Math.min(100, touchCount * 20 + Math.max(0, 30 - (candles.length - lastTestedIndex)));
    
    lowZones.push({
      price: avgPrice,
      type,
      strength,
      touchCount,
      lastTestedIndex
    });
  }

  const allZones = [...highZones, ...lowZones];
  allZones.sort((a, b) => b.strength - a.strength);

  return allZones.slice(0, 10);
}

export function detectLiquiditySweep(
  candles: CandleInput[],
  zones: LiquidityZone[],
  orderBookImbalance?: number
): SweepSignal | null {
  if (candles.length === 0 || zones.length === 0) return null;

  const lastCandle = candles[candles.length - 1]!;
  
  let last20VolAvg = 0;
  if (candles.length > 1) {
    const volSlice = candles.slice(-21, -1);
    last20VolAvg = volSlice.reduce((sum, c) => sum + c.volume, 0) / volSlice.length;
  }
  
  const volumeConfirmation = lastCandle.volume > 1.5 * last20VolAvg;
  
  let bestSignal: SweepSignal | null = null;
  let highestConfidence = -1;

  for (const zone of zones) {
    let isSweep = false;
    let direction: SweepDirection | null = null;
    let reclaimed = false;
    let obAligned = false;
    let sweepDepth = 0;

    if (zone.type === 'SWING_HIGH' || zone.type === 'EQUAL_HIGHS') {
      if (lastCandle.high > zone.price && lastCandle.close < zone.price) {
        isSweep = true;
        direction = 'BEARISH_SWEEP';
        reclaimed = true; // since close < price
        sweepDepth = lastCandle.high - zone.price;
        if (orderBookImbalance !== undefined && orderBookImbalance < 0) {
          obAligned = true;
        }
      }
    } else if (zone.type === 'SWING_LOW' || zone.type === 'EQUAL_LOWS') {
      if (lastCandle.low < zone.price && lastCandle.close > zone.price) {
        isSweep = true;
        direction = 'BULLISH_SWEEP';
        reclaimed = true; // since close > price
        sweepDepth = zone.price - lastCandle.low;
        if (orderBookImbalance !== undefined && orderBookImbalance > 0) {
          obAligned = true;
        }
      }
    }

    if (isSweep && direction) {
      let confidence = 40;
      if (reclaimed) confidence += 20;
      if (volumeConfirmation) confidence += 20;
      if (obAligned) confidence += 10;
      if (zone.strength > 50) confidence += 10;
      
      confidence = Math.max(0, Math.min(100, confidence));

      if (confidence > highestConfidence) {
        highestConfidence = confidence;
        bestSignal = {
          detected: true,
          direction,
          sweepZone: zone,
          sweepDepth,
          reclaimed,
          volumeConfirmation,
          confidence
        };
      }
    }
  }

  return bestSignal;
}
