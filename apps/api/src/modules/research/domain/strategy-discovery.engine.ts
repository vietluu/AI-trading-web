export type StrategyKind =
  | 'TREND_FOLLOWING'
  | 'MEAN_REVERSION'
  | 'MOMENTUM'
  | 'BREAKOUT'
  | 'FUNDING_ARBITRAGE'
  | 'VOLUME_EXPANSION'
  | 'VOLATILITY_COMPRESSION'
  | 'LIQUIDITY_SWEEP'
  | 'HYBRID_AI';

export interface StrategyCandidate {
  key: string;
  name: string;
  kind: StrategyKind;
  score: number;
  expectedValue: number;
  profitFactor: number;
  sharpeRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  rules: string[];
  parameters: Record<string, number | string>;
}

