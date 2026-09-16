import { describe, expect, it } from 'vitest';
import { deriveClosedCandleExecutionContext } from '../../src/modules/pipeline/domain/closed-candle-execution-context';
import { ExchangeInterval, ExchangeProvider } from '../../src/exchange/domain/exchange.types';
import { IndicatorStatus } from '../../src/market-data/domain/market-data.enums';
import type { IndicatorSnapshot, NormalizedCandle } from '../../src/market-data/domain/market-data.types';
import { analyzeMultiTimeframe } from '../../src/modules/pipeline/domain/multi-timeframe-analysis';

function closedEvidenceFixture() {
  const cutoff = new Date('2026-09-15T18:44:59.999Z');
  const snapshot: IndicatorSnapshot = {
    provider: ExchangeProvider.OKX_FUTURES, symbol: 'ZRO-USDT', interval: ExchangeInterval.FIFTEEN_MINUTES,
    candleOpenTime: new Date(cutoff.getTime() - 899999), candleCloseTime: cutoff,
    status: IndicatorStatus.CLOSED, calculatedAt: cutoff, calculationVersion: 2,
    values: { atr14: '4', ema20: '110', ema50: '108', adx14: '25', volumeChangePercent: '50' },
  };
  const candles: NormalizedCandle[] = Array.from({ length: 22 }, (_, index) => ({
    provider: snapshot.provider, symbol: snapshot.symbol, interval: snapshot.interval,
    openTime: new Date(cutoff.getTime() - (21 - index) * 900000 - 899999),
    closeTime: new Date(cutoff.getTime() - (21 - index) * 900000),
    open: '105', high: '110', low: '100', close: '105', volume: '100', isClosed: true,
  }));
  candles[21] = { ...candles[21]!, open: '109.5', high: '111', low: '107', close: '108', volume: '160' };
  const multiTimeframe = analyzeMultiTimeframe('15m', [
    { timeframe: '15m', close: 112, ema20: 110, ema50: 108, isClosed: true },
    { timeframe: '1h', close: 112, ema20: 110, ema50: 108, isClosed: true },
  ]);
  return { snapshot, candles, multiTimeframe };
}

describe('closed-candle execution context', () => {
  it('confirms a range short only from a closed upper-bound rejection', () => {
    const context = deriveClosedCandleExecutionContext({ ...closedEvidenceFixture(), strategyKey: 'mean-reversion', direction: 'SHORT' });
    expect(context).toMatchObject({ setup: 'RANGE_REVERSION', action: 'ENTER', triggerConfirmed: true,
      usesClosedPrimaryCandle: true, sourceDataCutoff: '2026-09-15T18:44:59.999Z',
      priceLocation: { rangePercentile: 0.8, distanceFromTriggerAtr: 0.5 } });
  });

  it.each([false, true])('ignores a future breakout even when isClosed=%s', (isClosed) => {
    const evidence = closedEvidenceFixture();
    const context = deriveClosedCandleExecutionContext({ ...evidence, strategyKey: 'breakout', direction: 'LONG',
      candles: [...evidence.candles, { ...evidence.candles[21]!, close: '115', high: '116',
        closeTime: new Date('2026-09-15T18:59:59.999Z'), isClosed }] });
    expect(context).toMatchObject({ action: 'WAIT', triggerConfirmed: false, usesClosedPrimaryCandle: true,
      sourceDataCutoff: '2026-09-15T18:44:59.999Z' });
  });

  it('does not treat location alone as a range rejection', () => {
    const evidence = closedEvidenceFixture();
    evidence.candles[21] = { ...evidence.candles[21]!, open: '107', high: '109', low: '106', close: '108' };
    expect(deriveClosedCandleExecutionContext({ ...evidence, strategyKey: 'mean-reversion', direction: 'SHORT' }))
      .toMatchObject({ action: 'WAIT', triggerConfirmed: false, priceLocation: { rangePercentile: 0.8 } });
  });

  it('requires a breakout before the retest, within the chase limit', () => {
    const evidence = closedEvidenceFixture();
    evidence.candles[20] = { ...evidence.candles[20]!, open: '109', low: '108', high: '113', close: '112' };
    evidence.candles[21] = { ...evidence.candles[21]!, open: '110.5', low: '109.8', high: '112', close: '111' };
    expect(deriveClosedCandleExecutionContext({ ...evidence, strategyKey: 'breakout', direction: 'LONG' }))
      .toMatchObject({ setup: 'BREAKOUT_RETEST', action: 'ENTER', priceLocation: { distanceFromTriggerAtr: 0.25 } });
    evidence.candles[21].close = '114';
    evidence.candles[21].high = '115';
    expect(deriveClosedCandleExecutionContext({ ...evidence, strategyKey: 'breakout', direction: 'LONG' }).action).toBe('WAIT');
  });

  it('requires an aligned closed EMA pullback for trend entries', () => {
    const evidence = closedEvidenceFixture();
    evidence.candles[21] = { ...evidence.candles[21]!, open: '110.2', low: '109', high: '112', close: '111' };
    expect(deriveClosedCandleExecutionContext({ ...evidence, strategyKey: 'trend', direction: 'LONG' }))
      .toMatchObject({ setup: 'TREND_PULLBACK', action: 'ENTER', priceLocation: { distanceFromSupportAtr: 0.25 } });
    evidence.snapshot.values.ema50 = '113';
    expect(deriveClosedCandleExecutionContext({ ...evidence, strategyKey: 'trend', direction: 'LONG' }).action).toBe('WAIT');
  });

  it('keeps momentum canonical and requires impulse, volume, ADX and closed timeframe agreement', () => {
    const evidence = closedEvidenceFixture();
    evidence.candles[21] = { ...evidence.candles[21]!, open: '110.2', low: '109', high: '112', close: '111' };
    const input = { ...evidence, strategyKey: 'momentum-scalp', direction: 'LONG' as const };
    expect(deriveClosedCandleExecutionContext(input)).toMatchObject({ setup: 'TREND_PULLBACK', action: 'ENTER' });
    for (const field of ['adx14', 'volumeChangePercent'] as const) {
      expect(deriveClosedCandleExecutionContext({ ...input, snapshot: { ...input.snapshot, values: { ...input.snapshot.values, [field]: '0' } } }).action).toBe('WAIT');
    }
    expect(deriveClosedCandleExecutionContext({ ...input, multiTimeframe: { ...input.multiTimeframe, frames: input.multiTimeframe.frames.map(f => ({ ...f, isClosed: false })) } }).action).toBe('WAIT');
    evidence.candles[21].open = '111';
    expect(deriveClosedCandleExecutionContext(input).action).toBe('WAIT');
  });

  it('permits only a reduced transition probe with a squeeze, reclaimed sweep and participation', () => {
    const evidence = closedEvidenceFixture();
    evidence.snapshot.values.bollingerBands = { lower: '103', middle: '105', upper: '107' };
    evidence.candles[21] = { ...evidence.candles[21]!, open: '100.1', low: '99', high: '102', close: '101' };
    const input = { ...evidence, strategyKey: 'ai-core', regime: 'PRE_BREAKOUT' as const, direction: 'LONG' as const };
    expect(deriveClosedCandleExecutionContext(input)).toMatchObject({ setup: 'TRANSITION_PROBE', action: 'PROBE', riskTier: 'PROBE' });
    evidence.snapshot.values.volumeChangePercent = '0';
    expect(deriveClosedCandleExecutionContext(input).action).toBe('WAIT');
  });

  it('does not fabricate geometry when lookback or ATR is missing', () => {
    const evidence = closedEvidenceFixture();
    expect(deriveClosedCandleExecutionContext({ ...evidence, candles: evidence.candles.slice(-1), strategyKey: 'mean-reversion', direction: 'SHORT' }))
      .toMatchObject({ action: 'WAIT', usesClosedPrimaryCandle: true, priceLocation: {} });
    delete evidence.snapshot.values.atr14;
    expect(deriveClosedCandleExecutionContext({ ...evidence, strategyKey: 'mean-reversion', direction: 'SHORT' }).action).toBe('WAIT');
  });

  it('rejects provisional snapshots and a missing primary closed candle', () => {
    const evidence = closedEvidenceFixture();
    evidence.candles[21]!.isClosed = false;
    expect(deriveClosedCandleExecutionContext({ ...evidence, strategyKey: 'mean-reversion', direction: 'SHORT' }))
      .toMatchObject({ action: 'WAIT', usesClosedPrimaryCandle: false });
    evidence.candles[21]!.isClosed = true;
    evidence.snapshot.status = IndicatorStatus.PROVISIONAL;
    expect(deriveClosedCandleExecutionContext({ ...evidence, strategyKey: 'mean-reversion', direction: 'SHORT' }).action).toBe('WAIT');
  });
});
