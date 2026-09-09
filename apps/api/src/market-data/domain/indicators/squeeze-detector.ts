import { calculateBollingerBands } from './indicator-calculator';
import { calculateKeltnerChannels } from './keltner-channels';

export interface SqueezeState {
  isSqueezing: boolean;
  squeezeIntensity: number;
  atrPercentile: number;
  consecutiveSqueezeBars: number;
  momentumDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  breakoutProbability: number;
}

function computeATR(highs: number[], lows: number[], closes: number[], period: number = 14): number | undefined {
  if (closes.length < period + 1) return undefined;
  const trueRanges: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const high = highs[i]!;
    const low = lows[i]!;
    const prevClose = closes[i - 1]!;
    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let atr = trueRanges.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]!) / period;
  }
  return atr;
}

export function detectSqueeze(
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
  macdHistogram?: string | number
): SqueezeState {
  const defaultState: SqueezeState = {
    isSqueezing: false,
    squeezeIntensity: 0,
    atrPercentile: 50,
    consecutiveSqueezeBars: 0,
    momentumDirection: 'NEUTRAL',
    breakoutProbability: 0
  };

  const bb = calculateBollingerBands(closes, 20, 2);
  const kc = calculateKeltnerChannels(closes, highs, lows, 20, 14, 1.5);

  if (!bb || !kc) {
    return defaultState;
  }

  const bbUpper = Number(bb.upper);
  const bbLower = Number(bb.lower);
  const bbMiddle = Number(bb.middle);
  const kcUpper = kc.upper;
  const kcLower = kc.lower;
  const kcMiddle = kc.middle;

  const isSqueezing = bbUpper < kcUpper && bbLower > kcLower;

  let squeezeIntensity = 0;
  if (isSqueezing && bbMiddle > 0 && kcMiddle > 0) {
    const bbBandwidth = (bbUpper - bbLower) / bbMiddle;
    const kcBandwidth = (kcUpper - kcLower) / kcMiddle;
    if (kcBandwidth > 0) {
      squeezeIntensity = Math.min(100, Math.max(0, Math.round((1 - bbBandwidth / kcBandwidth) * 100)));
    }
  }

  const atrHistoryLength = Math.min(100, closes.length - 15);
  const atrs: number[] = [];
  for (let i = 0; i < atrHistoryLength; i++) {
    const end = closes.length - i;
    const h = highs.slice(0, end);
    const l = lows.slice(0, end);
    const c = closes.slice(0, end);
    const a = computeATR(h, l, c, 14);
    if (a !== undefined) atrs.push(a);
  }

  let atrPercentile = 50;
  if (atrs.length > 0) {
    const currentAtr = atrs[0]!;
    const sortedAtrs = [...atrs].sort((a, b) => a - b);
    let countBelow = 0;
    for (const a of sortedAtrs) {
      if (a < currentAtr) countBelow++;
      else break;
    }
    atrPercentile = Math.round((countBelow / sortedAtrs.length) * 100);
  }

  let consecutiveSqueezeBars = 0;
  for (let i = 1; i <= 50; i++) {
    const end = closes.length - i;
    if (end < 20) break;
    const c = closes.slice(0, end);
    const h = highs.slice(0, end);
    const l = lows.slice(0, end);
    const b = calculateBollingerBands(c, 20, 2);
    const k = calculateKeltnerChannels(c, h, l, 20, 14, 1.5);
    if (b && k) {
      const bu = Number(b.upper);
      const bl = Number(b.lower);
      if (bu < k.upper && bl > k.lower) {
        consecutiveSqueezeBars++;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  let momentumDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (macdHistogram !== undefined) {
    const hist = Number(macdHistogram);
    if (hist > 0) momentumDirection = 'BULLISH';
    else if (hist < 0) momentumDirection = 'BEARISH';
  }

  const last5AvgVol = volumes.slice(-5).reduce((sum, v) => sum + v, 0) / Math.min(5, volumes.length);
  const last20AvgVol = volumes.slice(-20).reduce((sum, v) => sum + v, 0) / Math.min(20, volumes.length);
  const volumeCompression = last5AvgVol < last20AvgVol * 0.8;

  let breakoutProb = isSqueezing ? 40 : 0;
  breakoutProb += Math.min(20, squeezeIntensity * 0.2);
  breakoutProb += Math.min(15, (100 - atrPercentile) * 0.15);
  breakoutProb += Math.min(15, consecutiveSqueezeBars * 3);
  breakoutProb += volumeCompression ? 10 : 0;

  breakoutProb = Math.max(0, Math.min(100, Math.round(breakoutProb)));

  return {
    isSqueezing,
    squeezeIntensity,
    atrPercentile,
    consecutiveSqueezeBars,
    momentumDirection,
    breakoutProbability: breakoutProb
  };
}
