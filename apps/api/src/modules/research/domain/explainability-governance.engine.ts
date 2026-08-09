type RecommendationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type RecommendationStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'DEPLOYED' | 'ROLLED_BACK';

export interface FullQuantRecommendation {
  id?: string;
  title: string;
  moduleSource: string;
  problemStatement: string;
  evidenceText: string;
  historicalResult: Record<string, unknown>;
  expectedBenefit: string;
  estimatedRisk: string;
  priority: RecommendationPriority;
  implementationCost: string;
  rollbackPlan: string;
  status: RecommendationStatus;
}

export function buildQuantRecommendation(input: {
  id?: string;
  title: string;
  moduleSource: string;
  problemStatement: string;
  evidenceText: string;
  historicalResult: Record<string, unknown>;
  expectedBenefit: string;
  estimatedRisk: string;
  priority?: RecommendationPriority;
  implementationCost?: string;
  rollbackPlan: string;
  status?: RecommendationStatus;
}): FullQuantRecommendation {
  return {
    id: input.id,
    title: input.title,
    moduleSource: input.moduleSource,
    problemStatement: input.problemStatement,
    evidenceText: input.evidenceText,
    historicalResult: input.historicalResult,
    expectedBenefit: input.expectedBenefit,
    estimatedRisk: input.estimatedRisk,
    priority: input.priority ?? 'MEDIUM',
    implementationCost: input.implementationCost ?? 'LOW',
    rollbackPlan: input.rollbackPlan,
    status: input.status ?? 'PENDING_APPROVAL',
  };
}

export function generateDefaultRecommendations(): FullQuantRecommendation[] {
  return [
    buildQuantRecommendation({
      id: 'rec-1',
      title: 'Increase Technical Agent Weight in Trending Regime',
      moduleSource: 'WEIGHT_OPTIMIZER',
      problemStatement: 'Technical indicators have higher predictive power during trending regimes, but current weights allocate equal share.',
      evidenceText: 'Backtest over 1,200 candles showed Technical alignment accuracy of 82% in trending regimes vs 55% in ranging regimes.',
      historicalResult: { sampleSize: 1200, winRateIncreasePct: 6.8, sharpeImprovement: 0.35 },
      expectedBenefit: 'Expected Value increases from +1.45 to +1.85 per trade.',
      estimatedRisk: 'Minor increase in drawdowns if regime detection misclassifies sideways markets.',
      priority: 'HIGH',
      implementationCost: 'LOW',
      rollbackPlan: 'Revert weight configuration in database to default BASE_WEIGHTS dictionary.',
    }),
    buildQuantRecommendation({
      id: 'rec-2',
      title: 'Enforce News Shock Wait Guard during High-Impact Macro Events',
      moduleSource: 'FACTOR_DISCOVERY',
      problemStatement: 'High-impact CPI and FOMC announcements cause sharp spread spikes and slippage.',
      evidenceText: '3 out of 4 false positive trades occurred within 10 minutes of major macro releases.',
      historicalResult: { falsePositivesAvoided: 18, netPnLImprovementPct: 4.2 },
      expectedBenefit: 'Reduces maximum portfolio drawdown by 2.1%.',
      estimatedRisk: 'May miss rapid trend reversals during volatile news spikes.',
      priority: 'CRITICAL',
      implementationCost: 'LOW',
      rollbackPlan: 'Toggle off NEWS_SHOCK_GUARD feature flag in user settings.',
    }),
  ];
}
