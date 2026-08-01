export type RsiState = 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
export type MacdTrend = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export function mapRsiState(rsi: number): RsiState {
  if (!Number.isFinite(rsi)) return 'NEUTRAL';
  if (rsi > 70) return 'OVERBOUGHT';
  if (rsi < 30) return 'OVERSOLD';
  return 'NEUTRAL';
}

export function mapMacdTrend(histogram: number): MacdTrend {
  if (!Number.isFinite(histogram) || histogram === 0) return 'NEUTRAL';
  return histogram > 0 ? 'BULLISH' : 'BEARISH';
}
