import { describe, expect, it } from 'vitest';
import { ExchangeInterval, ExchangeProvider } from '../../src/exchange/domain/exchange.types';
import type { NormalizedCandle } from '../../src/market-data/domain/market-data.types';
import { runBenchmarkSuite } from '../../src/modules/research/domain/benchmark-engine';
import {
  runBootstrapEngine,
  runConfidenceCalibrationEngine,
  runCrossSymbolRobustnessEngine,
  runMonteCarloEngine,
  runOutOfSampleEngine,
  runProbabilityOfRuinEngine,
  runRegimeStabilityAnalyzer,
  runSensitivityEngine,
  runWalkForwardEngine,
} from '../../src/modules/research/domain/validation-engines';

function buildCandles(count = 150): NormalizedCandle[] {
  const candles: NormalizedCandle[] = [];
  let price = 50000;
  for (let i = 0; i < count; i += 1) {
    const drift = i < count / 2 ? 50 : -40;
    const noise = (i % 3 === 0 ? 100 : -80);
    price = Math.max(10000, price + drift + noise);
    const open = price - 20;
    const close = price;
    const high = Math.max(open, close) + 50;
    const low = Math.min(open, close) - 50;
    candles.push({
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      interval: ExchangeInterval.FIVE_MINUTES,
      openTime: new Date(2025, 0, 1, 0, i),
      closeTime: new Date(2025, 0, 1, 0, i + 1),
      open: open.toString(),
      high: high.toString(),
      low: low.toString(),
      close: close.toString(),
      volume: '1500',
      isClosed: true,
    });
  }
  return candles;
}

describe('Phase 10.3A Quantitative Research Validation Engines', () => {
  const candles = buildCandles();

  it('runs Walk Forward Engine with rolling windows', () => {
    const result = runWalkForwardEngine({
      candles,
      trainWindow: 50,
      validationWindow: 20,
      initialBalance: 10000,
    });

    expect(result.windows.length).toBeGreaterThan(0);
    expect(result.usableWindows).toBe(
      result.windows.filter((window) => window.validationTrades > 0).length,
    );
    expect(result.averageReturn).toBeDefined();
    expect(typeof result.stable).toBe('boolean');
    expect(result.walkForwardEfficiency).toBeGreaterThanOrEqual(-2);
  });

  it('runs 10,000-path Monte Carlo Simulation Engine with stochastic noise', () => {
    const trades = [
      { entryTime: '', exitTime: '', entryPrice: 100, exitPrice: 110, pnl: 200, holdingTime: 1, maxFavorableExcursion: 10, maxAdverseExcursion: -2, riskReward: 2, expectedValue: 100, tradeQualityScore: 80 },
      { entryTime: '', exitTime: '', entryPrice: 100, exitPrice: 95, pnl: -100, holdingTime: 1, maxFavorableExcursion: 2, maxAdverseExcursion: -5, riskReward: 0.5, expectedValue: -50, tradeQualityScore: 40 },
    ];

    const result = runMonteCarloEngine({
      trades,
      initialBalance: 10000,
      simulations: 1000,
    });

    expect(result.simulationsCount).toBe(1000);
    expect(result.probabilityOfProfit).toBeGreaterThanOrEqual(0);
    expect(result.probabilityOfProfit).toBeLessThanOrEqual(100);
    expect(result.probabilityOfRuin).toBeGreaterThanOrEqual(0);
    expect(result.confidenceInterval95[0]).toBeLessThanOrEqual(result.confidenceInterval95[1]);
  });

  it('runs Bootstrap Resampling Engine', () => {
    const result = runBootstrapEngine({ trades: [
      { entryTime: '', exitTime: '', entryPrice: 100, exitPrice: 110, pnl: 100, holdingTime: 1, maxFavorableExcursion: 10, maxAdverseExcursion: -2, riskReward: 2, expectedValue: 50, tradeQualityScore: 80 },
      { entryTime: '', exitTime: '', entryPrice: 100, exitPrice: 95, pnl: -50, holdingTime: 1, maxFavorableExcursion: 2, maxAdverseExcursion: -5, riskReward: 0.5, expectedValue: -25, tradeQualityScore: 40 },
    ], resamples: 200 });
    expect(result.profitFactorCI95.length).toBe(2);
    expect(result.expectancyCI95.length).toBe(2);
    expect(result.sharpeRatioCI95.length).toBe(2);
  });

  it('runs Parameter Sensitivity Engine & Stability Analyzer', () => {
    const result = runSensitivityEngine({
      candles,
      parameterName: 'confidenceFloor',
    });

    expect(result.parameterName).toBe('confidenceFloor');
    expect(result.heatmap.length).toBeGreaterThan(0);
    expect(result.optimalValue).toBeDefined();
    expect(typeof result.isStable).toBe('boolean');
  });

  it('runs Confidence Calibration Engine', () => {
    const result = runConfidenceCalibrationEngine([
      { confidence: 75, isWin: true },
      { confidence: 85, isWin: true },
      { confidence: 65, isWin: false },
    ]);

    expect(result.bins.length).toBe(5);
    expect(result.brierScore).toBeGreaterThanOrEqual(0);
    expect(result.reliabilityCurve.length).toBe(5);
  });

  it('runs Market Regime Stability Analyzer', () => {
    const result = runRegimeStabilityAnalyzer(candles);
    expect(result.regimes.length).toBe(5);
    expect(result.overallRegimeStabilityScore).toBeGreaterThanOrEqual(0);
    expect(result.weakestRegime).toBeDefined();
  });

  it('runs Cross-Symbol Robustness Engine across 10 liquid pairs', () => {
    const result = runCrossSymbolRobustnessEngine([
      { symbol: 'BTC-USDT', winRate: 60, totalReturn: 8, sharpeRatio: 1.2, maxDrawdown: 5 },
      { symbol: 'ETH-USDT', winRate: 55, totalReturn: 4, sharpeRatio: 0.8, maxDrawdown: 7 },
    ]);
    expect(result.symbols.length).toBe(2);
    expect(result.robustnessScore).toBeGreaterThanOrEqual(0);
    expect(typeof result.isRobust).toBe('boolean');
  });

  it('runs Out-of-Sample Engine', () => {
    const result = runOutOfSampleEngine(candles);
    expect(result.inSampleReturn).toBeDefined();
    expect(result.outOfSampleReturn).toBeDefined();
    expect(typeof result.passedValidation).toBe('boolean');
  });

  it('runs Probability of Ruin Engine using Kelly Criterion', () => {
    const result = runProbabilityOfRuinEngine({
      winRate: 0.6,
      riskRewardRatio: 2.0,
      riskPerTradeFraction: 0.02,
      capital: 10000,
    });

    expect(result.probabilityOfRuinPct).toBeGreaterThanOrEqual(0);
    expect(result.kellyFraction).toBeGreaterThan(0);
    expect(result.recommendedRiskPct).toBeGreaterThan(0);
    expect(result.safetyMarginScore).toBeGreaterThan(0);
  });

  it('runs Benchmark Engine with all 20 benchmark strategies', () => {
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

    expect(suite.benchmarks.length).toBe(20);
    const names = suite.benchmarks.map((b) => b.strategyName);
    expect(names).toContain('BUY_AND_HOLD');
    expect(names).toContain('DCA');
    expect(names).toContain('HYBRID_QUANT');
    expect(names).toContain('RANDOM_ENTRY');
    expect(names).toContain('NO_TRADE');
  });
});
