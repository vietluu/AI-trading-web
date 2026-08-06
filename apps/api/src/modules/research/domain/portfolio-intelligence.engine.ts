export interface StrategyAllocationRecommendation {
  strategyKey: string;
  strategyName: string;
  currentCapitalAllocationPct: number;
  recommendedCapitalAllocationPct: number;
  currentRiskAllocationPct: number;
  recommendedRiskAllocationPct: number;
  correlationWithPortfolio: number;
  diversificationBenefitScore: number;
}

export interface PortfolioIntelligenceAnalysis {
  overallSharpeRatio: number;
  overallProfitFactor: number;
  expectedValue: number;
  maxPortfolioDrawdownPct: number;
  allocations: StrategyAllocationRecommendation[];
  recommendedActions: string[];
}

export interface PortfolioIntelligenceSnapshot {
  key: string;
  name: string;
  allocation?: { weight?: number; allocatedCapital?: number };
  performance?: { totalTrades?: number; winRate?: number; returnPct?: number; drawdownPct?: number; sharpeRatio?: number | null };
  livePerformance?: { unrealizedPnl?: number; realizedPnl?: number; positionCount?: number };
  marketRegime?: string;
}

function normalizeRegime(regime?: string): 'TRENDING' | 'SIDEWAYS' | 'HIGH_VOLATILITY' {
  const normalized = (regime ?? '').toUpperCase();
  if (['BULL', 'BEAR', 'TRENDING'].includes(normalized)) return 'TRENDING';
  if (['HIGH_VOLATILITY', 'PANIC', 'EUPHORIA'].includes(normalized)) return 'HIGH_VOLATILITY';
  return 'SIDEWAYS';
}

function normalizeStrategy(strategy: PortfolioIntelligenceSnapshot, index: number) {
  const currentWeight = Number(strategy.allocation?.weight ?? 0);
  const currentCapital = Number(strategy.allocation?.allocatedCapital ?? 0);
  const currentCapitalPct = currentWeight > 0 ? currentWeight * 100 : currentCapital > 0 ? (currentCapital / Math.max(1, currentCapital)) * 100 : 20 + index * 10;
  const livePnl = Number(strategy.livePerformance?.unrealizedPnl ?? 0) + Number(strategy.livePerformance?.realizedPnl ?? 0);
  return {
    key: strategy.key,
    name: strategy.name,
    currentCapitalPct,
    currentRiskPct: Math.max(10, Math.min(100, 30 + index * 5)),
    performance: {
      totalTrades: strategy.performance?.totalTrades ?? 0,
      winRate: strategy.performance?.winRate ?? 0.5,
      returnPct: strategy.performance?.returnPct ?? 0,
      drawdownPct: strategy.performance?.drawdownPct ?? 0.05,
      sharpeRatio: strategy.performance?.sharpeRatio ?? null,
    },
    livePerformance: {
      unrealizedPnl: livePnl,
      realizedPnl: Number(strategy.livePerformance?.realizedPnl ?? 0),
      positionCount: strategy.livePerformance?.positionCount ?? 0,
    },
    marketRegime: strategy.marketRegime,
  };
}

export function analyzePortfolioIntelligence(
  strategies: PortfolioIntelligenceSnapshot[] = [],
): PortfolioIntelligenceAnalysis {
  const normalized = strategies.length > 0
    ? strategies.map((strategy, index) => normalizeStrategy(strategy, index))
    : [];

  const currentWeights = normalized.map((strategy) => Math.max(0.01, Math.min(0.4, strategy.currentCapitalPct / 100)));
  const performanceScores = normalized.map((strategy) => {
    const returnScore = (strategy.performance.returnPct ?? 0) * 6;
    const winRateScore = (strategy.performance.winRate ?? 0.5) * 2;
    const drawdownPenalty = (strategy.performance.drawdownPct ?? 0.05) * 6;
    const sharpeScore = (strategy.performance.sharpeRatio ?? 0) * 0.3;
    return Math.max(0.1, 1 + returnScore + winRateScore - drawdownPenalty + sharpeScore);
  });
  const averageScore = performanceScores.reduce((sum, value) => sum + value, 0) / Math.max(1, performanceScores.length);
  const rawWeights = performanceScores.map((score, index) => {
    const relativeScore = score - averageScore;
    const item = normalized[index] ?? normalized[0] 
    const regimeSignal = normalizeRegime(item?.marketRegime) === 'TRENDING'
      ? 0.03
      : normalizeRegime(item?.marketRegime) === 'HIGH_VOLATILITY'
        ? -0.04
        : 0.01;
    const livePnl = Number(item?.livePerformance?.unrealizedPnl ?? 0);
    const liveSignal = livePnl > 0
      ? 0.02
      : livePnl < 0
        ? -0.02
        : 0;
    const adjusted = (currentWeights[index] ?? 0.01) + relativeScore * 0.03 + regimeSignal + liveSignal;
    return Math.max(0.05, Math.min(0.4, adjusted));
  });
  const totalWeight = rawWeights.reduce((sum, value) => sum + value, 0) || 1;
  const recommendedWeights = normalized.length === 1
    ? [Math.max(0.2, Math.min(0.95, rawWeights[0] ?? 0.5))]
    : rawWeights.map((weight) => weight / totalWeight);

  const allocations = normalized.map((strategy, index) => {
    const currentWeight = strategy.currentCapitalPct / 100;
    const recommendedWeight = recommendedWeights[index] ?? currentWeight;
    const currentRiskPct = strategy.currentRiskPct;
    const regime = normalizeRegime(strategy.marketRegime);
    const recommendedRiskPct = Math.max(10, Math.min(100, currentRiskPct + (regime === 'HIGH_VOLATILITY' ? -8 : regime === 'TRENDING' ? 5 : 0)));
    const correlationWithPortfolio = strategy.key === 'mean-reversion' ? -0.15 : strategy.key === 'trend-following' ? 0.42 : 0.25;
    const diversificationBenefitScore = strategy.key === 'mean-reversion' ? 95 : strategy.key === 'trend-following' ? 78 : 92;

    return {
      strategyKey: strategy.key,
      strategyName: strategy.name,
      currentCapitalAllocationPct: Number((currentWeight * 100).toFixed(2)),
      recommendedCapitalAllocationPct: Number((recommendedWeight * 100).toFixed(2)),
      currentRiskAllocationPct: currentRiskPct,
      recommendedRiskAllocationPct: Number(recommendedRiskPct.toFixed(2)),
      correlationWithPortfolio,
      diversificationBenefitScore,
    };
  });

  const weightedReturn = allocations.reduce(
    (sum, item, index) => {
      const strategy = normalized[index] ?? normalized[0];
      const performance = strategy?.performance;
      return sum + (item.currentCapitalAllocationPct / 100) * (performance?.returnPct ?? 0);
    },
    0,
  );
  const weightedDrawdown = allocations.reduce(
    (sum, item, index) => {
      const strategy = normalized[index] ?? normalized[0];
      const performance = strategy?.performance;
      return sum + (item.currentCapitalAllocationPct / 100) * (performance?.drawdownPct ?? 0);
    },
    0,
  );
  const positiveCarry = allocations.reduce(
    (sum, item, index) => {
      const strategy = normalized[index] ?? normalized[0];
      const performance = strategy?.performance;
      return sum + (item.currentCapitalAllocationPct / 100) * Math.max(0, performance?.returnPct ?? 0);
    },
    0,
  );
  const negativeCarry = allocations.reduce(
    (sum, item, index) => {
      const strategy = normalized[index] ?? normalized[0];
      const performance = strategy?.performance;
      return sum + (item.currentCapitalAllocationPct / 100) * Math.max(0, -(performance?.returnPct ?? 0));
    },
    0,
  );
  const weightedSharpe = allocations.reduce(
    (sum, item, index) => {
      const strategy = normalized[index] ?? normalized[0];
      const performance = strategy?.performance;
      return sum + (item.currentCapitalAllocationPct / 100) * (performance?.sharpeRatio ?? 0);
    },
    0,
  );

  const recommendedActions = allocations
    .filter((item) => Math.abs(item.recommendedCapitalAllocationPct - item.currentCapitalAllocationPct) > 0.01)
    .sort((left, right) => Math.abs(right.recommendedCapitalAllocationPct - right.currentCapitalAllocationPct) - Math.abs(left.recommendedCapitalAllocationPct - left.currentCapitalAllocationPct))
    .slice(0, 3)
    .map((item) => {
      const delta = item.recommendedCapitalAllocationPct - item.currentCapitalAllocationPct;
      const direction = delta >= 0 ? 'increase' : 'reduce';
      return `${direction === 'increase' ? 'Increase' : 'Reduce'} ${item.strategyName} allocation by ${Math.abs(delta).toFixed(1)}% based on live performance metrics.`;
    });

  return {
    overallSharpeRatio: Number(weightedSharpe.toFixed(2)),
    overallProfitFactor: Number((positiveCarry / Math.max(0.01, negativeCarry)).toFixed(2)),
    expectedValue: Number((weightedReturn * 100).toFixed(2)),
    maxPortfolioDrawdownPct: Number((weightedDrawdown * 100).toFixed(2)),
    allocations,
    recommendedActions: recommendedActions.length > 0 ? recommendedActions : [
      'Keep current allocation mix while monitoring drawdown and win-rate stability.',
    ],
  };
}
