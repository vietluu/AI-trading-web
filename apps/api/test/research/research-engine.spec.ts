import { describe, expect, it } from 'vitest';
import { ExchangeInterval, ExchangeProvider } from '../../src/exchange/domain/exchange.types';
import {
  runHistoricalBacktest,
  runMonteCarloSimulation,
  runWalkForwardValidation,
} from '../../src/modules/research/domain/backtest-engine';
import type { NormalizedCandle } from '../../src/market-data/domain/market-data.types';

function buildCandles(): NormalizedCandle[] {
  const candles: NormalizedCandle[] = [];
  let price = 1000;
  for (let i = 0; i < 90; i += 1) {
    const drift = i < 45 ? 2 : -2.2;
    const noise = i % 5 === 0 ? 6 : i % 3 === 0 ? -4 : 1;
    price = Math.max(900, price + drift + noise);
    const open = price - 1.5;
    const close = price;
    const high = Math.max(open, close) + 2;
    const low = Math.min(open, close) - 2;
    candles.push({
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      interval: ExchangeInterval.FIVE_MINUTES,
      openTime: new Date(2024, 0, 1, 0, i),
      closeTime: new Date(2024, 0, 1, 0, i + 1),
      open: open.toString(),
      high: high.toString(),
      low: low.toString(),
      close: close.toString(),
      volume: '1000',
      isClosed: true,
    });
  }
  return candles;
}

describe('research backtesting engine', () => {
  it('produces a non-empty backtest summary with trade metrics', () => {
    const candles = buildCandles();
    const summary = runHistoricalBacktest({
      candles,
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      interval: ExchangeInterval.FIVE_MINUTES,
      initialBalance: 10000,
      leverage: 2,
      riskPerTrade: 0.01,
      riskRewardRatio: 2,
    });

    expect(summary.trades.length).toBeGreaterThan(0);
    expect(Number.isFinite(summary.metrics.totalReturn)).toBe(true);
    expect(summary.metrics.totalReturn).toBeGreaterThan(-1);
    expect(summary.metrics.winRate).toBeGreaterThanOrEqual(0);
    expect(summary.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
  });

  it('computes monte carlo and walk-forward validation summaries', () => {
    const candles = buildCandles();
    const backtest = runHistoricalBacktest({
      candles,
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      interval: ExchangeInterval.FIVE_MINUTES,
      initialBalance: 10000,
      leverage: 2,
      riskPerTrade: 0.01,
      riskRewardRatio: 2,
    });

    const monteCarlo = runMonteCarloSimulation({
      trades: backtest.trades,
      initialBalance: 10000,
      simulations: 40,
      seed: 7,
    });

    const walkForward = runWalkForwardValidation({
      candles,
      validationWindow: 12,
      trainWindow: 24,
      initialBalance: 10000,
    });

    expect(monteCarlo.probabilityOfProfit).toBeGreaterThanOrEqual(0);
    expect(monteCarlo.probabilityOfProfit).toBeLessThanOrEqual(1);
    expect(walkForward.windows.length).toBeGreaterThan(0);
    expect(walkForward.stable).toBeDefined();
  });
});
