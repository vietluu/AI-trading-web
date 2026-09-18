import type { CanonicalRegime, ExecutionContext } from '@platform/shared';
import type { IndicatorSnapshot, NormalizedCandle } from '../../../market-data/domain/market-data.types';
import { buildExecutionContext, EXECUTION_CONTEXT_POLICY, validateSetupLocation } from './execution-context';
import { evaluateMultiTimeframeConfirmation, type MultiTimeframeAnalysis } from './multi-timeframe-analysis';
import { pinnedClosedCandles } from './pinned-core-analysis';

export interface ClosedCandleEvidence {
  snapshot: IndicatorSnapshot;
  candles: readonly NormalizedCandle[];
  multiTimeframe?: MultiTimeframeAnalysis;
}

export interface DeriveClosedCandleExecutionContextInput extends ClosedCandleEvidence {
  strategyKey: string;
  direction: 'LONG' | 'SHORT' | 'WAIT';
  regime?: CanonicalRegime;
}

const LOOKBACK = 20;
function positive(value: string | undefined): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
function validCandle(c: NormalizedCandle): boolean {
  const [open, high, low, close] = [c.open, c.high, c.low, c.close].map(positive);
  return open !== undefined && high !== undefined && low !== undefined && close !== undefined &&
    high >= Math.max(open, close) && low <= Math.min(open, close) && high > low;
}
function boundaries(candles: readonly NormalizedCandle[]) {
  if (candles.length < LOOKBACK || !candles.every(validCandle)) return undefined;
  const lower = Math.min(...candles.map(c => Number(c.low)));
  const upper = Math.max(...candles.map(c => Number(c.high)));
  return upper > lower ? { lower, upper } : undefined;
}

export function closedCandleGeometry(evidence: ClosedCandleEvidence) {
  const candles = pinnedClosedCandles(evidence.snapshot, evidence.candles);
  const latest = candles.at(-1);
  const primary = latest && validCandle(latest) &&
    new Date(latest.closeTime).getTime() === new Date(evidence.snapshot.candleCloseTime).getTime()
    ? latest : undefined;
  return { candles, primary, price: primary ? Number(primary.close) : undefined,
    atr: positive(evidence.snapshot.values.atr14),
    boundaries: primary ? boundaries(candles.slice(-LOOKBACK - 1, -1)) : undefined };
}

/** Execution facts are derived only from the pinned, closed primary candle. */
export function deriveClosedCandleExecutionContext(input: DeriveClosedCandleExecutionContextInput): ExecutionContext {
  const geometry = closedCandleGeometry(input);
  const { primary, candles, atr } = geometry;
  const price = geometry.price;
  const long = input.direction === 'LONG';
  const values = input.snapshot.values;
  const ema20 = positive(values.ema20);
  const ema50 = positive(values.ema50);
  let regime: CanonicalRegime = input.strategyKey === 'mean-reversion' ? 'RANGING'
    : input.strategyKey === 'breakout' ? 'BREAKOUT'
    : input.strategyKey === 'trend' || input.strategyKey === 'momentum-scalp' ? 'TRENDING'
    : input.regime ?? 'TRENDING';
  let setup: ExecutionContext['setup'] = regime === 'RANGING' ? 'RANGE_REVERSION'
    : regime === 'PRE_BREAKOUT' ? 'TRANSITION_PROBE'
    : regime === 'BREAKOUT' ? 'BREAKOUT_RETEST' : 'TREND_PULLBACK';
  let support = geometry.boundaries?.lower;
  let resistance = geometry.boundaries?.upper;
  let triggerPrice: number | undefined;
  let confirmed = false;

  if (primary && price !== undefined && atr && geometry.boundaries && input.direction !== 'WAIT') {
    const open = Number(primary.open);
    const low = Number(primary.low);
    const high = Number(primary.high);
    const rejects = (level: number) => long
      ? low <= level && price > level && price > open
      : high >= level && price < level && price < open;
    const priorRange = boundaries(candles.slice(-LOOKBACK - 2, -2));
    const previous = candles.at(-2);
    const breakoutLevel = long ? priorRange?.upper : priorRange?.lower;
    const retest = breakoutLevel !== undefined && previous && validCandle(previous) &&
      (long ? Number(previous.close) > breakoutLevel && Number(previous.open) <= breakoutLevel
        : Number(previous.close) < breakoutLevel && Number(previous.open) >= breakoutLevel) &&
      rejects(breakoutLevel);
    if (input.strategyKey === 'momentum-scalp' && retest) {
      setup = 'BREAKOUT_RETEST'; regime = 'BREAKOUT';
    }
    if (setup === 'RANGE_REVERSION' || setup === 'TRANSITION_PROBE') {
      triggerPrice = long ? support : resistance;
      confirmed = triggerPrice !== undefined && rejects(triggerPrice);
      if (setup === 'TRANSITION_PROBE') {
        const bands = values.bollingerBands;
        const upper = positive(bands?.upper);
        const lower = positive(bands?.lower);
        const squeeze = upper !== undefined && lower !== undefined && upper > lower && upper - lower <= 2 * atr;
        confirmed = confirmed && squeeze && Number(values.volumeChangePercent) >= 0.35 &&
          (long ? low < support! : high > resistance!) && timeframeAgreement(input);
      }
    } else if (setup === 'BREAKOUT_RETEST') {
      triggerPrice = breakoutLevel;
      confirmed = Boolean(retest);
    } else if (ema20 !== undefined && ema50 !== undefined) {
      if (long) support = ema20; else resistance = ema20;
      const aligned = long ? ema20 > ema50 : ema20 < ema50;
      const pullbackBounce = rejects(ema20);
      const trendContinuation = aligned && (long
        ? price > ema20 && price > open && (Number(values.volumeChangePercent) >= 0.20 || Number(values.adx14) >= 20) && price - ema20 <= 3.0 * atr
        : price < ema20 && price < open && (Number(values.volumeChangePercent) >= 0.20 || Number(values.adx14) >= 20) && ema20 - price <= 3.0 * atr
      );
      if (pullbackBounce) {
        triggerPrice = Math.abs(price - ema20) <= atr * EXECUTION_CONTEXT_POLICY.maximumTriggerChaseDistanceAtr ? ema20 : open;
        confirmed = aligned;
      } else if (trendContinuation && input.strategyKey !== 'trend') {
        triggerPrice = open;
        confirmed = true;
      }
    }
    if (input.strategyKey === 'momentum-scalp') {
      const impulse = (price - open) / open * 100;
      confirmed = confirmed && (long ? impulse >= 0.15 : impulse <= -0.15) && Math.abs(impulse) <= 2.5 &&
        Number(values.volumeChangePercent) >= 0.35 && Number(values.adx14) >= 18 && timeframeAgreement(input);
    }
    confirmed = confirmed && triggerPrice !== undefined &&
      Math.abs(price - triggerPrice) / atr <= EXECUTION_CONTEXT_POLICY.maximumTriggerChaseDistanceAtr;
  }
  const context = buildExecutionContext({ regime, setup, action: confirmed ? setup === 'TRANSITION_PROBE' ? 'PROBE' : 'ENTER' : 'WAIT',
    price: price ?? 0, support, resistance, triggerPrice, atr,
    sourceDataCutoff: input.snapshot.candleCloseTime, primaryCandleClosed: primary !== undefined, triggerConfirmed: confirmed });
  if (input.direction !== 'WAIT' && validateSetupLocation(context, input.direction).length) {
    return { ...context, action: 'WAIT', riskTier: 'NONE', triggerConfirmed: false };
  }
  return context;
}

function timeframeAgreement(input: DeriveClosedCandleExecutionContextInput): boolean {
  const analysis = input.multiTimeframe;
  if (!analysis) return false;
  const frames = analysis.frames.filter(frame => frame.isClosed === true);
  const result = evaluateMultiTimeframeConfirmation({ direction: input.direction, primaryTimeframe: analysis.primaryTimeframe, frames });
  return frames.some(frame => frame.timeframe === analysis.primaryTimeframe) && result.directionalFrames >= 2 &&
    result.normalEntryConfirmed && result.confirmation >= 60;
}
