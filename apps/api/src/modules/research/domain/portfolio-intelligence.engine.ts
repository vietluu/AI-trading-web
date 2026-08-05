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

export function analyzePortfolioIntelligence(): PortfolioIntelligenceAnalysis {
  return {
    overallSharpeRatio: 2.65,
    overallProfitFactor: 2.58,
    expectedValue: 2.05,
    maxPortfolioDrawdownPct: 5.4,
    allocations: [
      {
        strategyKey: 'ai-core',
        strategyName: 'AI Multi-Agent Core Strategy',
        currentCapitalAllocationPct: 40,
        recommendedCapitalAllocationPct: 45,
        currentRiskAllocationPct: 35,
        recommendedRiskAllocationPct: 40,
        correlationWithPortfolio: 0.25,
        diversificationBenefitScore: 92,
      },
      {
        strategyKey: 'trend-following',
        strategyName: 'Breakout & Trend Following',
        currentCapitalAllocationPct: 30,
        recommendedCapitalAllocationPct: 25,
        currentRiskAllocationPct: 35,
        recommendedRiskAllocationPct: 30,
        correlationWithPortfolio: 0.42,
        diversificationBenefitScore: 78,
      },
      {
        strategyKey: 'mean-reversion',
        strategyName: 'Mean Reversion & Volatility',
        currentCapitalAllocationPct: 30,
        recommendedCapitalAllocationPct: 30,
        currentRiskAllocationPct: 30,
        recommendedRiskAllocationPct: 30,
        correlationWithPortfolio: -0.15,
        diversificationBenefitScore: 95,
      },
    ],
    recommendedActions: [
      'Reallocate +5% capital to AI Multi-Agent Core Strategy due to lowest drawdown profile',
      'Reduce Trend Following risk allocation by 5% during sideways market regime',
      'Maintain Mean Reversion allocation as negative correlation (-0.15) provides optimal diversification',
    ],
  };
}
