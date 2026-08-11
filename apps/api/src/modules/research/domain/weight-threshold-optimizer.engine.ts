export interface OptimizedWeightsResult {
  scope: 'AGENT' | 'FACTOR' | 'OPPORTUNITY' | 'RISK' | 'REGIME';
  weights: Record<string, number>;
  expectedValue: number;
  sharpeRatio: number;
  profitFactor: number;
}

export interface OptimizedThresholdResult {
  thresholdName:
    | 'CONFIDENCE'
    | 'OPPORTUNITY'
    | 'ATR'
    | 'VOLUME'
    | 'LIQUIDITY'
    | 'RISK_REWARD'
    | 'COOLDOWN'
    | 'STOP_LOSS'
    | 'TAKE_PROFIT';
  previousValue: number;
  optimizedValue: number;
  expectedImprovement: number; // percentage
}

