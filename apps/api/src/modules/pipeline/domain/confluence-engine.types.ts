export interface ConfluenceExecutionContext {
  executionDecision: unknown;
  tradePlanContext?: unknown;
  strategyKey: string;
  quant?: unknown;
  interval?: string;
  provider: string;
}

export interface ConfluenceSignal {
  pipelineRunId: string;
  symbol: string;
  decision: "LONG" | "SHORT";
  confidence: number;
  opportunityScore: number;
  expectedValue: number;
  riskScore: number;
  strategyKey: string;
  compositeScore: number;
  regime: string;
  volatilityAtr?: number;
  referencePrice: number;
  executionContext: ConfluenceExecutionContext;
}

export interface ConfluenceBatchMeta {
  batchId: string;
  userId: string;
  expectedCount: number;
  reportedCount: number;
  createdAt: number;
}

export interface ConfluenceEvaluation {
  selected: ConfluenceSignal;
  rejected: ConfluenceSignal[];
  concordanceCount: number;
  totalSymbols: number;
  concordanceRatio: number;
  sizeFactor: number;
  direction: "LONG" | "SHORT";
}

export interface ConfluenceSizeConfig {
  boostPerSignal: number;
  maxSizeFactor: number;
  minSignalsForBoost: number;
  qualityBonus?: {
    minOpportunityScore?: number;
    minExpectedValue?: number;
    bonusMultiplier?: number;
  };
}

export const DEFAULT_CONFLUENCE_SIZE_CONFIG: ConfluenceSizeConfig = {
  boostPerSignal: 0.25,
  maxSizeFactor: 2.0,
  minSignalsForBoost: 2,
  qualityBonus: {
    minOpportunityScore: 78,
    minExpectedValue: 0.3,
    bonusMultiplier: 0.1,
  },
};
