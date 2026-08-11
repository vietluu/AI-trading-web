export interface HypothesisInput {
  category: 'INDICATOR' | 'FACTOR_COMBINATION' | 'PROMPT' | 'RULE' | 'WEIGHTING' | 'SCORING' | 'POSITION_SIZING';
  symbol: string;
  historicalWinRate?: number;
  historicalReturnPct?: number;
  drawdownPct?: number;
}

export interface GeneratedHypothesis {
  title: string;
  category: HypothesisInput['category'];
  description: string;
  hypothesisText: string;
  expectedValue: number;
  profitFactor: number;
  sharpeRatio: number;
  statisticalProof: {
    pValue: number;
    sampleSize: number;
    tStatistic: number;
    confidenceInterval: [number, number];
  };
}

