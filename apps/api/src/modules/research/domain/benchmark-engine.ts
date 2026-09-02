import type { ExchangeInterval, ExchangeProvider } from '../../../exchange/domain/exchange.types';
import type { NormalizedCandle } from '../../../market-data/domain/market-data.types';
import { runHistoricalBacktest } from './backtest-engine';

export type BenchmarkStrategyName =
  | 'BUY_AND_HOLD'
  | 'DCA'
  | 'EMA_CROSS'
  | 'SMA_CROSS'
  | 'RSI_MEAN_REVERSION'
  | 'MACD_TREND'
  | 'BOLLINGER_BAND'
  | 'SUPERTREND'
  | 'DONCHIAN_BREAKOUT'
  | 'TURTLE_STRATEGY'
  | 'VWAP_STRATEGY'
  | 'GRID_TRADING'
  | 'MOMENTUM_STRATEGY'
  | 'BREAKOUT_STRATEGY'
  | 'STATISTICAL_MEAN_REVERSION'
  | 'HYBRID_QUANT'
  | 'PREVIOUS_AI_VERSION'
  | 'PREVIOUS_STABLE_RELEASE'
  | 'RANDOM_ENTRY'
  | 'NO_TRADE';

export interface BenchmarkMetricSet {
  totalReturn: number;
  annualReturn: number;
  monthlyReturn: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maximumDrawdown: number;
  averageHoldingTime: number;
  tradeFrequency: number;
  exposure: number;
  capitalEfficiency: number;
  recoveryFactor: number;
  ulcerIndex: number;
  probabilityOfRuin: number;
  rankingScore: number;
}

export interface BenchmarkResult {
  strategyName: BenchmarkStrategyName;
  metrics: BenchmarkMetricSet;
  trades: number;
}

export interface BenchmarkSuite {
  benchmarks: BenchmarkResult[];
  leaderboard: Array<{ strategyName: string; rankingScore: number }>;
}

export interface MarketRegimeSignal {
  type: 'BULL_TREND' | 'BEAR_TREND' | 'SIDEWAYS' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'NEWS_SHOCK' | 'LIQUIDITY_CRISIS' | 'FUNDING_EXTREME';
  confidence: number;
  evidence: string[];
}

export interface StrategyRecommendation {
  strategy: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE' | 'SCALPING' | 'SWING' | 'TREND_FOLLOWING' | 'MEAN_REVERSION' | 'BREAKOUT' | 'HYBRID';
  rationale: string;
  regime: MarketRegimeSignal['type'];
}

export interface OptimizationRecommendation {
  title: string;
  expectedImprovement: string;
  historicalEvidence: string;
  confidenceLevel: number;
  potentialRisks: string[];
}

export function runBenchmarkSuite(input: {
  candles: NormalizedCandle[];
  provider: ExchangeProvider;
  symbol: string;
  interval: ExchangeInterval;
  initialBalance: number;
  leverage: number;
  riskPerTrade: number;
  riskRewardRatio: number;
}): BenchmarkSuite {
  const strategies: BenchmarkStrategyName[] = [
    'BUY_AND_HOLD',
    'DCA',
    'EMA_CROSS',
    'SMA_CROSS',
    'RSI_MEAN_REVERSION',
    'MACD_TREND',
    'BOLLINGER_BAND',
    'SUPERTREND',
    'DONCHIAN_BREAKOUT',
    'TURTLE_STRATEGY',
    'VWAP_STRATEGY',
    'GRID_TRADING',
    'MOMENTUM_STRATEGY',
    'BREAKOUT_STRATEGY',
    'STATISTICAL_MEAN_REVERSION',
    'HYBRID_QUANT',
    'PREVIOUS_AI_VERSION',
    'PREVIOUS_STABLE_RELEASE',
    'RANDOM_ENTRY',
    'NO_TRADE',
  ];

  const benchmarks = strategies.map((strategyName) => {
    const summary = runHistoricalBacktest({
      candles: input.candles,
      provider: input.provider,
      symbol: input.symbol,
      interval: input.interval,
      initialBalance: input.initialBalance,
      leverage: input.leverage,
      riskPerTrade: input.riskPerTrade,
      riskRewardRatio: input.riskRewardRatio,
      strategyName,
    });

    const metrics = summarizeMetrics(summary.metrics, summary.trades.length);
    return {
      strategyName,
      metrics,
      trades: summary.trades.length,
    } satisfies BenchmarkResult;
  });

  return {
    benchmarks,
    leaderboard: buildBenchmarkLeaderboard(benchmarks),
  };
}

export function buildBenchmarkLeaderboard(benchmarks: BenchmarkResult[]): Array<{ strategyName: string; rankingScore: number }> {
  return [...benchmarks]
    .sort((left, right) => right.metrics.rankingScore - left.metrics.rankingScore)
    .map((benchmark) => ({
      strategyName: benchmark.strategyName,
      rankingScore: Number(benchmark.metrics.rankingScore.toFixed(2)),
    }));
}

export function detectMarketRegime(candles: NormalizedCandle[]): MarketRegimeSignal {
  if (candles.length < 20) {
    return { type: 'SIDEWAYS', confidence: 0.5, evidence: ['Insufficient candles'] };
  }

  const closes = candles.map((candle) => Number(candle.close));
  const first = closes[0] ?? 0;
  const last = closes[closes.length - 1] ?? first;
  const drift = (last - first) / Math.max(1, first);
  
  // Calculate SMA and Standard Deviation for Bollinger Band Width
  const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
  const variance = closes.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / closes.length;
  const stdDev = Math.sqrt(variance);
  const bbw = (stdDev * 4) / Math.max(1, sma); // Width = (2 * stdDev * 2) / SMA
  
  const volatility = closes.reduce((sum, value, index) => sum + Math.abs((value - (closes[index - 1] ?? value)) / Math.max(1, value)), 0);
  const averageVolatility = volatility / Math.max(1, closes.length - 1);

  if (averageVolatility > 0.04 || bbw > 0.15) {
    return { type: 'HIGH_VOLATILITY', confidence: 0.78, evidence: ['Volatility or Bollinger Band Width exceeded high-volatility threshold'] };
  }
  if (bbw < 0.02) {
    return { type: 'LOW_VOLATILITY', confidence: 0.85, evidence: ['Bollinger Band Width indicates severe compression'] };
  }
  
  // Stricter trend logic: require significant drift AND sufficient BBW expansion (no compression)
  if (drift > 0.03 && bbw >= 0.02) {
    return { type: 'BULL_TREND', confidence: 0.82, evidence: ['Positive drift with sufficient band width expansion'] };
  }
  if (drift < -0.03 && bbw >= 0.02) {
    return { type: 'BEAR_TREND', confidence: 0.82, evidence: ['Negative drift with sufficient band width expansion'] };
  }

  return { type: 'SIDEWAYS', confidence: 0.68, evidence: ['Price action lacks directional drift or is in compression'] };
}

export function recommendStrategy(input: {
  regime: MarketRegimeSignal;
  symbol: string;
  volatility: number;
  liquidity: number;
}): StrategyRecommendation {
  if (input.regime.type === 'BULL_TREND' || input.regime.type === 'BEAR_TREND') {
    return { strategy: 'TREND_FOLLOWING', rationale: `Trend-following is preferred for ${input.symbol} in a directional regime.`, regime: input.regime.type };
  }
  if (input.regime.type === 'HIGH_VOLATILITY') {
    return { strategy: 'CONSERVATIVE', rationale: `A conservative stance is preferable when volatility is elevated for ${input.symbol}.`, regime: input.regime.type };
  }
  if (input.regime.type === 'LOW_VOLATILITY') {
    return { strategy: 'MEAN_REVERSION', rationale: `Mean reversion is preferred when volatility is subdued for ${input.symbol}.`, regime: input.regime.type };
  }
  if (input.volatility > 0.03 || input.liquidity < 0.5) {
    return { strategy: 'BREAKOUT', rationale: `Breakout logic is suitable when ${input.symbol} has elevated volatility or weak liquidity.`, regime: input.regime.type };
  }

  return { strategy: 'BALANCED', rationale: `A balanced strategy fits the current neutral regime for ${input.symbol}.`, regime: input.regime.type };
}

export function generateOptimizationRecommendations(benchmarks: BenchmarkResult[], regime: MarketRegimeSignal): OptimizationRecommendation[] {
  const top = [...benchmarks].sort((left, right) => right.metrics.rankingScore - left.metrics.rankingScore)[0];
  const recommendations: OptimizationRecommendation[] = [];

  if (top && top.metrics.profitFactor < 1.4) {
    recommendations.push({
      title: 'Reduce the weight on high-noise benchmarks during choppy regimes',
      expectedImprovement: 'Expected improvement: +0.1 to +0.25 profit factor',
      historicalEvidence: `Historical evidence from ${top.strategyName} suggests lower noise sensitivity in ${regime.type}.`,
      confidenceLevel: 0.74,
      potentialRisks: ['May reduce participation in strong trend windows'],
    });
  }

  if (regime.type === 'BULL_TREND' || regime.type === 'BEAR_TREND') {
    recommendations.push({
      title: 'Increase trend-following exposure and tighten risk controls',
      expectedImprovement: 'Expected improvement: +0.08 to +0.2 Sharpe ratio',
      historicalEvidence: 'Trend regimes historically improve directional alpha when coupled with disciplined risk limits.',
      confidenceLevel: 0.8,
      potentialRisks: ['Can overfit to short-lived momentum spikes'],
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      title: 'Keep position sizing and thresholds unchanged',
      expectedImprovement: 'Expected improvement: neutral',
      historicalEvidence: 'The current regime has not produced enough evidence to justify a change.',
      confidenceLevel: 0.55,
      potentialRisks: ['No significant change in expected performance'],
    });
  }

  return recommendations;
}

function summarizeMetrics(base: ReturnType<typeof runHistoricalBacktest>['metrics'], trades: number): BenchmarkMetricSet {
  const rankingScore =
    base.totalReturn * 0.25 +
    base.winRate * 0.2 +
    base.profitFactor * 0.15 +
    base.sharpeRatio * 0.15 +
    base.calmarRatio * 0.1 +
    (1 - base.maxDrawdown) * 0.15;

  return {
    totalReturn: Number(base.totalReturn.toFixed(4)),
    annualReturn: Number(base.annualizedReturn.toFixed(4)),
    monthlyReturn: Number(base.monthlyReturn.toFixed(4)),
    winRate: Number(base.winRate.toFixed(4)),
    profitFactor: Number(base.profitFactor.toFixed(4)),
    expectancy: Number(base.expectancy.toFixed(4)),
    sharpeRatio: Number(base.sharpeRatio.toFixed(4)),
    sortinoRatio: Number(base.sortinoRatio.toFixed(4)),
    calmarRatio: Number(base.calmarRatio.toFixed(4)),
    maximumDrawdown: Number(base.maxDrawdown.toFixed(4)),
    averageHoldingTime: Number(base.averageHoldingTime.toFixed(4)),
    tradeFrequency: Number((base.tradeFrequency || 0).toFixed(4)),
    exposure: Number((base.exposureTime || 0).toFixed(4)),
    capitalEfficiency: Number((base.totalReturn / Math.max(1, trades)).toFixed(4)),
    recoveryFactor: Number(base.recoveryFactor.toFixed(4)),
    ulcerIndex: Number(base.ulcerIndex.toFixed(4)),
    probabilityOfRuin: Number((trades > 0 ? 1 - Math.min(1, Math.max(0, base.winRate)) : 0).toFixed(4)),
    rankingScore: Number(Math.max(0, rankingScore).toFixed(4)),
  };
}
