import { calculateEMA } from './indicator-calculator';

export interface KeltnerChannelsResult {
  upper: number;
  middle: number;
  lower: number;
}

function calculateATRFromArrays(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): number | undefined {
  if (closes.length < period + 1) return undefined;
  
  const trueRanges: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const high = highs[i]!;
    const low = lows[i]!;
    const prevClose = closes[i - 1]!;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  if (trueRanges.length < period) return undefined;
  
  let atr = trueRanges.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]!) / period;
  }
  
  return atr;
}

export function calculateKeltnerChannels(
  closes: number[],
  highs: number[],
  lows: number[],
  emaPeriod: number = 20,
  atrPeriod: number = 14,
  multiplier: number = 1.5
): KeltnerChannelsResult | undefined {
  const minLength = Math.max(emaPeriod, atrPeriod + 1);
  if (closes.length < minLength || highs.length < minLength || lows.length < minLength) {
    return undefined;
  }

  const middle = calculateEMA(closes, emaPeriod);
  if (middle === undefined) return undefined;

  const atr = calculateATRFromArrays(highs, lows, closes, atrPeriod);
  if (atr === undefined) return undefined;

  const upper = middle + multiplier * atr;
  const lower = middle - multiplier * atr;

  return {
    upper: Number(upper.toFixed(8)),
    middle: Number(middle.toFixed(8)),
    lower: Number(lower.toFixed(8))
  };
}
