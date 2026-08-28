import type { AgentDataQuality, MarketRegime } from '@platform/shared';
import type { Weighting } from '../types/decision-service.types';

export const BASE_WEIGHTS: Weighting = {
  market: 20,
  technical: 25,
  news: 15,
  sentiment: 15,
  macro: 15,
  onchain: 10,
};

export const QUALITY_FACTOR: Record<AgentDataQuality, number> = {
  GOOD: 1,
  PARTIAL: 0.5,
  INSUFFICIENT: 0,
};

export const REGIME_FACTOR: Record<MarketRegime['type'], number> = {
  TRENDING: 1.05,
  RANGING: 0.95,
  HIGH_VOLATILITY: 0.9,
};

export const DECISION_THRESHOLDS = {
  DIRECTIONAL_BIAS_THRESHOLD: 20,
  MINIMUM_CONFIDENCE_THRESHOLD: 60,
  NEWS_POSITIVE_SHOCK: 10,
  NEWS_NEGATIVE_SHOCK: -20,
  CONFLICT_MEDIUM_PENALTY: 10,
  CONFLICT_HIGH_PENALTY: 35,
  QUALITY_PARTIAL_DEDUCTION: 5,
  QUALITY_INSUFFICIENT_DEDUCTION: 40,
  CORE_TREND_ALIGNMENT_BONUS: 10,
  PARTIAL_DATA_CONFIDENCE_CEILING: 75,
} as const;
