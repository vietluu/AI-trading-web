import { describe, expect, it } from 'vitest';
import { buildPinnedCoreAnalysis } from '../../src/modules/pipeline/domain/pinned-core-analysis';
import { ExchangeInterval, ExchangeProvider } from '../../src/exchange/domain/exchange.types';
import { IndicatorStatus } from '../../src/market-data/domain/market-data.enums';

describe('pinned closed-candle core analysis', () => {
  const cutoff = new Date('2026-09-15T14:44:59.999Z');
  const snapshot = { provider: ExchangeProvider.OKX_FUTURES, symbol: 'ZRO-USDT',
    interval: ExchangeInterval.FIFTEEN_MINUTES, candleOpenTime: new Date('2026-09-15T14:30:00Z'),
    candleCloseTime: cutoff, status: IndicatorStatus.CLOSED, values: {
      ema20: '0.9412', ema50: '0.9535', rsi14: '31.8', atr14: '0.0068',
      macd: { value: '-0.0048', signal: '-0.005', histogram: '0.0002' },
    }, calculatedAt: new Date(), calculationVersion: 2 };
  const closed = { provider: snapshot.provider, symbol: snapshot.symbol, interval: snapshot.interval,
    openTime: snapshot.candleOpenTime, closeTime: cutoff, open: '0.942', high: '0.943', low: '0.9216',
    close: '0.9311', volume: '100', isClosed: true };
  it('pins both analysts to the same RSI and closed price, excluding the forming candle', () => {
    const result = buildPinnedCoreAnalysis(snapshot, [closed, { ...closed,
      openTime: new Date('2026-09-15T14:45:00Z'), closeTime: new Date('2026-09-15T14:59:59.999Z'),
      close: '0.921', low: '0.9194', isClosed: false }]);
    expect(result?.technical.momentum.rsi).toBe('31.80');
    expect(result?.technical.structure.breakout).toBe(false);
    expect(result?.market.trend.direction).toBe('DOWN');
    expect(result?.sourceCutoff).toEqual(cutoff);
  });
  it('refuses a snapshot without its matching closed candle', () => {
    expect(buildPinnedCoreAnalysis(snapshot, [{ ...closed, closeTime: new Date('2026-09-15T14:29:59.999Z') }])).toBeUndefined();
  });
  it('exposes the exact closed evidence and refuses provisional indicators', () => {
    const result = buildPinnedCoreAnalysis(snapshot, [closed]);
    expect(result?.executionEvidence.snapshot.candleCloseTime).toEqual(cutoff);
    expect(result?.executionEvidence.candles).toEqual([closed]);
    expect(buildPinnedCoreAnalysis({ ...snapshot, status: IndicatorStatus.PROVISIONAL }, [closed])).toBeUndefined();
  });
});
