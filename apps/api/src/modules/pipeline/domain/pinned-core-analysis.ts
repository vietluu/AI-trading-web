import type { IndicatorSnapshot, NormalizedCandle } from '../../../market-data/domain/market-data.types';
import { deterministicMarketAnalysis, deterministicTechnicalAnalysis } from '../../agents/domain/analysis/deterministic-core-analysis';
import { IndicatorStatus } from '../../../market-data/domain/market-data.enums';

/** A shared evidence selector prevents analysis and execution from using different candles. */
export function pinnedClosedCandles(snapshot: IndicatorSnapshot, candles: readonly NormalizedCandle[]) {
  if (snapshot.status !== IndicatorStatus.CLOSED) return [];
  const cutoff = new Date(snapshot.candleCloseTime).getTime();
  return candles.filter(c => c.isClosed === true && c.provider === snapshot.provider &&
    c.symbol === snapshot.symbol && c.interval === snapshot.interval &&
    new Date(c.closeTime).getTime() <= cutoff)
    .sort((a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime());
}

/** Core decisions use a closed price and indicators with the same cutoff. */
export function buildPinnedCoreAnalysis(snapshot: IndicatorSnapshot | null | undefined, candles: NormalizedCandle[]) {
  if (!snapshot) return undefined;
  const cutoff = new Date(snapshot.candleCloseTime);
  const closed = pinnedClosedCandles(snapshot, candles);
  const latest = closed.at(-1);
  if (!latest || new Date(latest.closeTime).getTime() !== cutoff.getTime()) return undefined;
  const values = snapshot.values;
  const toolData = {
    'market.ticker.get': { price: latest.close },
    'market.candles.list': { candles: closed },
    'market.indicators.get': {
      ...values, rsi: values.rsi14, atr: values.atr14, macdHistogram: values.macd?.histogram,
      bollingerUpper: values.bollingerBands?.upper, bollingerMid: values.bollingerBands?.middle,
      bollingerLower: values.bollingerBands?.lower,
    },
  };
  const technical = deterministicTechnicalAnalysis(toolData, ['market.indicators.get', 'market.candles.list']);
  const market = deterministicMarketAnalysis(toolData, ['market.indicators.get', 'market.candles.list']);
  return technical && market ? { technical, market, sourceCutoff: cutoff,
    executionEvidence: { snapshot, candles: closed } } : undefined;
}
