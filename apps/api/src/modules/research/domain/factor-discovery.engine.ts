export type FactorCategory =
  | 'TECHNICAL'
  | 'STRUCTURE'
  | 'VOLUME'
  | 'FUNDING'
  | 'OPEN_INTEREST'
  | 'NEWS'
  | 'MACRO'
  | 'SENTIMENT'
  | 'ONCHAIN'
  | 'CORRELATION'
  | 'SEASONALITY';

export interface FactorEvaluationItem {
  factorName: string;
  category: FactorCategory;
  predictivePower: number; // 0 - 100
  contribution: number;     // 0 - 100
  noiseScore: number;       // 0 - 100
  redundancyScore: number;  // 0 - 100
}

