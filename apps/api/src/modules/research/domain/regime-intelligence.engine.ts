export type MarketRegimeType =
  | 'BULL'
  | 'BEAR'
  | 'SIDEWAYS'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'PANIC'
  | 'EUPHORIA';

export interface RegimeIntelligenceReport {
  symbol: string;
  detectedRegime: MarketRegimeType;
  confidence: number;
  recommendedStrategy: string;
  recommendedAgentWeights: Record<string, number>;
  recommendedThresholds: {
    confidenceThreshold: number;
    atrMultiplier: number;
    cooldownMinutes: number;
  };
}

export function detectMarketRegimeIntelligence(symbol: string): RegimeIntelligenceReport {
  const isBtc = symbol.toUpperCase().startsWith('BTC');
  const detectedRegime: MarketRegimeType = isBtc ? 'BULL' : 'HIGH_VOLATILITY';

  return {
    symbol,
    detectedRegime,
    confidence: 88,
    recommendedStrategy: isBtc ? 'Hybrid AI Trend Following' : 'Mean Reversion & Volatility Breakout',
    recommendedAgentWeights: {
      market: 25,
      technical: 30,
      news: 15,
      sentiment: 10,
      macro: 10,
      onchain: 10,
    },
    recommendedThresholds: {
      confidenceThreshold: 65,
      atrMultiplier: 2.2,
      cooldownMinutes: 15,
    },
  };
}
