export interface CandleInput {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ZoneType = 'SWING_HIGH' | 'SWING_LOW' | 'EQUAL_HIGHS' | 'EQUAL_LOWS';
export type SweepDirection = 'BULLISH_SWEEP' | 'BEARISH_SWEEP';
export type NoSweepReason =
  | 'NO_CANDLES'
  | 'NO_KNOWN_ZONE'
  | 'NO_PENETRATION'
  | 'NO_CLOSE_RECLAIM';

export interface LiquidityZone {
  price: number;
  type: ZoneType;
  strength: number;
  touchCount: number;
  lastTestedIndex: number;
}

export interface SweepSignal {
  detected: boolean;
  direction: SweepDirection | null;
  sweepZone: LiquidityZone | null;
  penetration: number;
  reclaimed: boolean;
  volumeConfirmation: boolean;
  confidence: number;
  reason: NoSweepReason | null;
}

export interface ConfirmedPivot {
  kind: 'HIGH' | 'LOW';
  price: number;
  index: number;
  confirmedIndex: number;
}

export function identifyConfirmedPivots(
  candles: CandleInput[],
  lookback: number = 100,
  pivotStrength: number = 5,
): ConfirmedPivot[] {
  if (candles.length < pivotStrength * 2 + 1 || pivotStrength < 1) return [];

  const startIndex = Math.max(pivotStrength, candles.length - lookback);
  const lastConfirmableIndex = candles.length - pivotStrength - 1;
  const pivots: ConfirmedPivot[] = [];

  for (let index = startIndex; index <= lastConfirmableIndex; index++) {
    const candle = candles[index]!;
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let neighbor = index - pivotStrength; neighbor <= index + pivotStrength; neighbor++) {
      if (neighbor === index) continue;
      if (candles[neighbor]!.high >= candle.high) isSwingHigh = false;
      if (candles[neighbor]!.low <= candle.low) isSwingLow = false;
    }

    if (isSwingHigh) {
      pivots.push({
        kind: 'HIGH',
        price: candle.high,
        index,
        confirmedIndex: index + pivotStrength,
      });
    }
    if (isSwingLow) {
      pivots.push({
        kind: 'LOW',
        price: candle.low,
        index,
        confirmedIndex: index + pivotStrength,
      });
    }
  }

  return pivots.sort((left, right) => left.index - right.index);
}

export function identifyLiquidityZones(
  candles: CandleInput[],
  lookback: number = 100,
  pivotStrength: number = 5
): LiquidityZone[] {
  const confirmedPivots = identifyConfirmedPivots(candles, lookback, pivotStrength);
  const swingHighs = confirmedPivots
    .filter((pivot) => pivot.kind === 'HIGH')
    .map((pivot) => ({ price: pivot.price, index: pivot.index }));
  const swingLows = confirmedPivots
    .filter((pivot) => pivot.kind === 'LOW')
    .map((pivot) => ({ price: pivot.price, index: pivot.index }));

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
): SweepSignal {
  const noSignal = (reason: NoSweepReason): SweepSignal => ({
    detected: false,
    direction: null,
    sweepZone: null,
    penetration: 0,
    reclaimed: false,
    volumeConfirmation: false,
    confidence: 0,
    reason,
  });

  if (candles.length === 0) return noSignal('NO_CANDLES');
  if (zones.length === 0) return noSignal('NO_KNOWN_ZONE');

  const lastCandle = candles[candles.length - 1]!;
  
  let last20VolAvg = 0;
  if (candles.length > 1) {
    const volSlice = candles.slice(-21, -1);
    last20VolAvg = volSlice.reduce((sum, c) => sum + c.volume, 0) / volSlice.length;
  }
  
  const volumeConfirmation = lastCandle.volume > 1.5 * last20VolAvg;
  
  let bestSignal: SweepSignal | null = null;
  let highestConfidence = -1;
  let penetratedKnownZone = false;

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
      if (lastCandle.high > zone.price) penetratedKnownZone = true;
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
      if (lastCandle.low < zone.price) penetratedKnownZone = true;
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
          penetration: sweepDepth,
          reclaimed,
          volumeConfirmation,
          confidence,
          reason: null,
        };
      }
    }
  }

  return bestSignal ?? noSignal(
    penetratedKnownZone ? 'NO_CLOSE_RECLAIM' : 'NO_PENETRATION',
  );
}
