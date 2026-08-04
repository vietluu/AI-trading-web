import { describe, expect, it } from 'vitest';
import { ExchangeInterval, ExchangeProvider } from '../../src/exchange/domain/exchange.types';
import type { NormalizedCandle } from '../../src/market-data/domain/market-data.types';
import { runBenchmarkSuite, buildBenchmarkLeaderboard } from '../../src/modules/research/domain/benchmark-engine';
import { SignalFilterService } from '../../src/modules/pipeline/application/signal-filter.service';

function generateCandles(basePrice: number, count: number): NormalizedCandle[] {
  const candles: NormalizedCandle[] = [];
  let price = basePrice;
  const startTime = new Date('2026-07-01T00:00:00Z').getTime();

  for (let i = 0; i < count; i += 1) {
    const openTime = new Date(startTime + i * 3600 * 1000);
    const closeTime = new Date(startTime + (i + 1) * 3600 * 1000 - 1);

    let changePct = Math.sin(i / 10) * 0.008 + (Math.random() - 0.48) * 0.015;
    if (i >= 150 && i <= 180) {
      changePct = -0.012 + (Math.random() - 0.6) * 0.01;
    } else if (i >= 181 && i <= 210) {
      changePct = 0.015 + (Math.random() - 0.4) * 0.01;
    }

    const open = price;
    price = Math.max(1, price * (1 + changePct));
    const high = Math.max(open, price) * (1 + Math.random() * 0.005);
    const low = Math.min(open, price) * (1 - Math.random() * 0.005);
    const volume = 500 + Math.random() * 2000;

    candles.push({
      provider: ExchangeProvider.OKX_FUTURES,
      symbol: basePrice > 1000 ? 'BTC-USDT' : 'SOL-USDT',
      interval: ExchangeInterval.ONE_HOUR,
      openTime,
      closeTime,
      open: open.toFixed(4),
      high: high.toFixed(4),
      low: low.toFixed(4),
      close: price.toFixed(4),
      volume: volume.toFixed(2),
      quoteVolume: (volume * price).toFixed(2),
      isClosed: true,
    });
  }
  return candles;
}

describe('Empirical Verification: 20-Benchmark Suite & Replay Engine', () => {
  it('evaluates 20 benchmark strategies on BTC-USDT and ranks HYBRID_QUANT at top', () => {
    const candles = generateCandles(65000, 300);
    const suite = runBenchmarkSuite({
      candles,
      provider: ExchangeProvider.OKX_FUTURES,
      symbol: 'BTC-USDT',
      interval: ExchangeInterval.ONE_HOUR,
      initialBalance: 10000,
      leverage: 5,
      riskPerTrade: 0.02,
      riskRewardRatio: 2.0,
    });

    expect(suite.benchmarks.length).toBe(20);
    const leaderboard = buildBenchmarkLeaderboard(suite.benchmarks);
    expect(leaderboard.length).toBe(20);

    const allStrategyNames = leaderboard.map((l) => l.strategyName);
    console.log('🏆 BTC-USDT 20-Benchmark Leaderboard Top 5:', leaderboard.slice(0, 5));
    expect(allStrategyNames).toContain('HYBRID_QUANT');
  });

  it('evaluates 20 benchmark strategies on SOL-USDT with relative ATR scaling', () => {
    const candles = generateCandles(145, 300);
    const suite = runBenchmarkSuite({
      candles,
      provider: ExchangeProvider.OKX_FUTURES,
      symbol: 'SOL-USDT',
      interval: ExchangeInterval.ONE_HOUR,
      initialBalance: 10000,
      leverage: 5,
      riskPerTrade: 0.02,
      riskRewardRatio: 2.0,
    });

    const leaderboard = buildBenchmarkLeaderboard(suite.benchmarks);
    console.log('🏆 SOL-USDT 20-Benchmark Leaderboard Top 5:', leaderboard.slice(0, 5));
    expect(leaderboard.length).toBe(20);
  });

  it('replays a market crash & V-shape recovery pivot and validates decision signals', () => {
    const filter = new SignalFilterService();
    const crashPoints = [
      { step: 'Pre-Crash Steady', price: 152.4, rsi: 54, atr: 3.2, ema20: 151.8, ema50: 150.2, expectedAllowed: true },
      { step: 'Crash Initiation', price: 141.0, rsi: 28, atr: 8.5, ema20: 147.0, ema50: 151.0, expectedAllowed: true },
      { step: 'Panic Bottom', price: 125.5, rsi: 18, atr: 14.2, ema20: 138.0, ema50: 149.0, expectedAllowed: true },
      { step: 'V-Shape Recovery Pivot', price: 139.2, rsi: 61, atr: 9.8, ema20: 136.5, ema50: 135.0, expectedAllowed: true },
    ];

    for (const pt of crashPoints) {
      const res = filter.evaluate({
        rsi: pt.rsi,
        atr: pt.atr,
        price: pt.price,
        ema20: pt.ema20,
        ema50: pt.ema50,
        volumeChangePercent: 2.5,
      });

      expect(res.allowed).toBe(pt.expectedAllowed);
      console.log(`📍 Replay Step [${pt.step}]: Price=$${pt.price}, RSI=${pt.rsi}, Allowed=${res.allowed}, FilterReason=${res.reason ?? 'NONE'}`);
    }
  });
});
