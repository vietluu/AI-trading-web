export interface CandleData {
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface MacdResult {
  value: string;
  signal: string;
  histogram: string;
}

export interface BollingerBandsResult {
  upper: string;
  middle: string;
  lower: string;
}

export interface CalculatedIndicators {
  sma20?: string;
  sma50?: string;
  sma200?: string;
  ema9?: string;
  ema20?: string;
  ema50?: string;
  ema200?: string;
  rsi14?: string;
  macd?: MacdResult;
  atr14?: string;
  adx14?: string;
  efficiencyRatio20?: string;
  bollingerBands?: BollingerBandsResult;
  volumeChangePercent?: string;
  priceChangePercent?: string;
  rollingHigh?: string;
  rollingLow?: string;
  volatility?: string;
}

export const CALCULATION_VERSION = 2;

function toDecimal(value: number, precision: number = 8): string {
  return value.toFixed(precision);
}

export function calculateSMA(
  closes: number[],
  period: number,
): number | undefined {
  if (closes.length < period) return undefined;
  const slice = closes.slice(-period);
  return slice.reduce((sum, val) => sum + val, 0) / period;
}

export function calculateEMA(
  closes: number[],
  period: number,
): number | undefined {
  if (closes.length < period) return undefined;
  const multiplier = 2 / (period + 1);
  let ema =
    closes.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = (closes[i]! - ema) * multiplier + ema;
  }
  return ema;
}

export function calculateRSI(
  closes: number[],
  period: number = 14,
): number | undefined {
  if (closes.length < period + 1) return undefined;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): MacdResult | undefined {
  if (closes.length < slowPeriod + signalPeriod) return undefined;
  const macdLine: number[] = [];
  for (let i = slowPeriod; i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    const fastEma = calculateEMA(slice, fastPeriod);
    const slowEma = calculateEMA(slice, slowPeriod);
    if (fastEma !== undefined && slowEma !== undefined) {
      macdLine.push(fastEma - slowEma);
    }
  }
  if (macdLine.length < signalPeriod) return undefined;
  const signal = calculateEMA(macdLine, signalPeriod);
  if (signal === undefined) return undefined;
  const value = macdLine[macdLine.length - 1]!;
  return {
    value: toDecimal(value),
    signal: toDecimal(signal),
    histogram: toDecimal(value - signal),
  };
}

export function calculateATR(
  candles: CandleData[],
  period: number = 14,
): number | undefined {
  if (candles.length < period + 1) return undefined;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = Number(candles[i]!.high);
    const low = Number(candles[i]!.low);
    const prevClose = Number(candles[i - 1]!.close);
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    trueRanges.push(tr);
  }
  if (trueRanges.length < period) return undefined;
  let atr =
    trueRanges.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]!) / period;
  }
  return atr;
}

export function calculateADX(
  candles: CandleData[],
  period: number = 14,
): number | undefined {
  if (candles.length < period * 2 + 1) return undefined;
  const trueRanges: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let index = 1; index < candles.length; index++) {
    const current = candles[index]!;
    const previous = candles[index - 1]!;
    const high = Number(current.high);
    const low = Number(current.low);
    const previousHigh = Number(previous.high);
    const previousLow = Number(previous.low);
    const previousClose = Number(previous.close);
    if (![high, low, previousHigh, previousLow, previousClose].every(Number.isFinite)) return undefined;
    const upMove = high - previousHigh;
    const downMove = previousLow - low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trueRanges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }
  let smoothedTr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0);
  let smoothedPlus = plusDm.slice(0, period).reduce((sum, value) => sum + value, 0);
  let smoothedMinus = minusDm.slice(0, period).reduce((sum, value) => sum + value, 0);
  const dx: number[] = [];
  for (let index = period; index < trueRanges.length; index++) {
    smoothedTr = smoothedTr - smoothedTr / period + trueRanges[index]!;
    smoothedPlus = smoothedPlus - smoothedPlus / period + plusDm[index]!;
    smoothedMinus = smoothedMinus - smoothedMinus / period + minusDm[index]!;
    if (smoothedTr <= 0) continue;
    const plusDi = (100 * smoothedPlus) / smoothedTr;
    const minusDi = (100 * smoothedMinus) / smoothedTr;
    const denominator = plusDi + minusDi;
    if (denominator > 0) dx.push((100 * Math.abs(plusDi - minusDi)) / denominator);
  }
  if (dx.length < period) return undefined;
  let adx = dx.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < dx.length; index++) {
    adx = (adx * (period - 1) + dx[index]!) / period;
  }
  return adx;
}

export function calculateEfficiencyRatio(
  closes: number[],
  period: number = 20,
): number | undefined {
  if (closes.length < period + 1) return undefined;
  const window = closes.slice(-(period + 1));
  const direction = Math.abs(window[window.length - 1]! - window[0]!);
  let movement = 0;
  for (let index = 1; index < window.length; index++) {
    movement += Math.abs(window[index]! - window[index - 1]!);
  }
  return movement > 0 ? direction / movement : 0;
}

export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDevMultiplier: number = 2,
): BollingerBandsResult | undefined {
  if (closes.length < period) return undefined;
  const sma = calculateSMA(closes, period);
  if (sma === undefined) return undefined;
  const slice = closes.slice(-period);
  const variance =
    slice.reduce((sum, val) => sum + (val - sma) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: toDecimal(sma + stdDevMultiplier * stdDev),
    middle: toDecimal(sma),
    lower: toDecimal(sma - stdDevMultiplier * stdDev),
  };
}

export function calculateVolumeChangePercent(
  volumes: number[],
): number | undefined {
  if (volumes.length < 2) return undefined;
  const prev = volumes[volumes.length - 2]!;
  const curr = volumes[volumes.length - 1]!;
  if (prev === 0) return undefined;
  return ((curr - prev) / prev) * 100;
}

export function calculatePriceChangePercent(
  closes: number[],
  period: number = 1,
): number | undefined {
  if (closes.length < period + 1) return undefined;
  const prev = closes[closes.length - 1 - period]!;
  const curr = closes[closes.length - 1]!;
  if (prev === 0) return undefined;
  return ((curr - prev) / prev) * 100;
}

export function calculateRollingHigh(
  highs: number[],
  period: number = 20,
): number | undefined {
  if (highs.length < period) return undefined;
  return Math.max(...highs.slice(-period));
}

export function calculateRollingLow(
  lows: number[],
  period: number = 20,
): number | undefined {
  if (lows.length < period) return undefined;
  return Math.min(...lows.slice(-period));
}

export function calculateVolatility(
  closes: number[],
  period: number = 20,
): number | undefined {
  if (closes.length < period + 1) return undefined;
  const returns: number[] = [];
  const slice = closes.slice(-(period + 1));
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1]! === 0) return undefined;
    returns.push(Math.log(slice[i]! / slice[i - 1]!));
  }
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance * 365) * 100;
}

export function calculateAllIndicators(candles: CandleData[]): CalculatedIndicators {
  if (candles.length === 0) return {};

  const closes = candles.map((c) => Number(c.close));
  const highs = candles.map((c) => Number(c.high));
  const lows = candles.map((c) => Number(c.low));
  const volumes = candles.map((c) => Number(c.volume));

  const result: CalculatedIndicators = {};

  const sma20 = calculateSMA(closes, 20);
  if (sma20 !== undefined) result.sma20 = toDecimal(sma20);
  const sma50 = calculateSMA(closes, 50);
  if (sma50 !== undefined) result.sma50 = toDecimal(sma50);
  const sma200 = calculateSMA(closes, 200);
  if (sma200 !== undefined) result.sma200 = toDecimal(sma200);

  const ema9 = calculateEMA(closes, 9);
  if (ema9 !== undefined) result.ema9 = toDecimal(ema9);
  const ema20 = calculateEMA(closes, 20);
  if (ema20 !== undefined) result.ema20 = toDecimal(ema20);
  const ema50 = calculateEMA(closes, 50);
  if (ema50 !== undefined) result.ema50 = toDecimal(ema50);
  const ema200 = calculateEMA(closes, 200);
  if (ema200 !== undefined) result.ema200 = toDecimal(ema200);

  const rsi = calculateRSI(closes, 14);
  if (rsi !== undefined) result.rsi14 = toDecimal(rsi, 2);

  const macd = calculateMACD(closes, 12, 26, 9);
  if (macd) result.macd = macd;

  const atr = calculateATR(candles, 14);
  if (atr !== undefined) result.atr14 = toDecimal(atr);

  const adx = calculateADX(candles, 14);
  if (adx !== undefined) result.adx14 = toDecimal(adx, 2);

  const efficiencyRatio = calculateEfficiencyRatio(closes, 20);
  if (efficiencyRatio !== undefined)
    result.efficiencyRatio20 = toDecimal(efficiencyRatio, 4);

  const bb = calculateBollingerBands(closes, 20, 2);
  if (bb) result.bollingerBands = bb;

  const volChange = calculateVolumeChangePercent(volumes);
  if (volChange !== undefined)
    result.volumeChangePercent = toDecimal(volChange, 4);

  const priceChange = calculatePriceChangePercent(closes);
  if (priceChange !== undefined)
    result.priceChangePercent = toDecimal(priceChange, 4);

  const rHigh = calculateRollingHigh(highs, 20);
  if (rHigh !== undefined) result.rollingHigh = toDecimal(rHigh);
  const rLow = calculateRollingLow(lows, 20);
  if (rLow !== undefined) result.rollingLow = toDecimal(rLow);

  const vol = calculateVolatility(closes, 20);
  if (vol !== undefined) result.volatility = toDecimal(vol, 4);

  return result;
}
