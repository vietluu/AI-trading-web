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

