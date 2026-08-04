import { describe, expect, it } from 'vitest';
import { ExchangeInterval, ExchangeProvider } from '../../src/exchange/domain/exchange.types';
import {
  buildBenchmarkLeaderboard,
  detectMarketRegime,
  generateOptimizationRecommendations,
  runBenchmarkSuite,
  recommendStrategy,
} from '../../src/modules/research/domain/benchmark-engine';
import type { NormalizedCandle } from '../../src/market-data/domain/market-data.types';

function buildCandles(): NormalizedCandle[] {
  const candles: NormalizedCandle[] = [];
  let price = 1000;
  for (let i = 0; i < 120; i += 1) {
    const drift = i < 60 ? 1.8 : -1.6;
    const noise = i % 5 === 0 ? 4 : i % 3 === 0 ? -3 : 1;
    price = Math.max(900, price + drift + noise);
    const open = price - 1.2;
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

describe('benchmark engine', () => {
  it('builds a benchmark suite with leaderboard output and adaptive recommendations', () => {
    const candles = buildCandles();
    const suite = runBenchmarkSuite({
      candles,
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      interval: ExchangeInterval.FIVE_MINUTES,
      initialBalance: 10000,
      leverage: 2,
      riskPerTrade: 0.01,
      riskRewardRatio: 2,
    });

    expect(suite.benchmarks.length).toBeGreaterThanOrEqual(13);
    expect(suite.leaderboard.length).toBeGreaterThanOrEqual(1);
    expect(suite.benchmarks[0]?.metrics.rankingScore).toBeGreaterThanOrEqual(0);
    expect(suite.benchmarks[0]?.metrics.probabilityOfRuin).toBeGreaterThanOrEqual(0);

    const leaderboard = buildBenchmarkLeaderboard(suite.benchmarks);
    expect(leaderboard[0]?.strategyName).toBeDefined();

    const regime = detectMarketRegime(candles);
    expect(['BULL_TREND', 'BEAR_TREND', 'SIDEWAYS', 'HIGH_VOLATILITY', 'LOW_VOLATILITY', 'NEWS_SHOCK', 'LIQUIDITY_CRISIS', 'FUNDING_EXTREME']).toContain(regime.type);

    const strategy = recommendStrategy({ regime, symbol: 'BTC-USDT', volatility: 0.04, liquidity: 0.7 });
    expect(strategy).toBeDefined();

    const recommendations = generateOptimizationRecommendations(suite.benchmarks, regime);
    expect(recommendations.length).toBeGreaterThan(0);
  });
});
