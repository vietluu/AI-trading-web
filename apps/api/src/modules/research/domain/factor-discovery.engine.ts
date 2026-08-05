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

export function evaluateFactors(): FactorEvaluationItem[] {
  const factors: { name: string; category: FactorCategory; power: number; contrib: number; noise: number; redun: number }[] = [
    { name: 'EMA Alignment (20/50/200)', category: 'TECHNICAL', power: 85, contrib: 25, noise: 15, redun: 10 },
    { name: 'RSI Divergence', category: 'TECHNICAL', power: 78, contrib: 20, noise: 22, redun: 15 },
    { name: 'Market Structure (HH/HL)', category: 'STRUCTURE', power: 88, contrib: 22, noise: 12, redun: 8 },
    { name: 'Volume Profile & Liquidity Spread', category: 'VOLUME', power: 82, contrib: 18, noise: 18, redun: 12 },
    { name: 'Funding Rate & Imbalance', category: 'FUNDING', power: 76, contrib: 15, noise: 25, redun: 20 },
    { name: 'Open Interest Velocity', category: 'OPEN_INTEREST', power: 80, contrib: 16, noise: 20, redun: 14 },
    { name: 'High-Impact News Events', category: 'NEWS', power: 90, contrib: 15, noise: 30, redun: 5 },
    { name: 'Global Macro Trend (Risk On/Off)', category: 'MACRO', power: 72, contrib: 15, noise: 10, redun: 18 },
    { name: 'Crowd Sentiment & Fear/Greed', category: 'SENTIMENT', power: 68, contrib: 12, noise: 35, redun: 25 },
    { name: 'Whale Net Exchange Outflow', category: 'ONCHAIN', power: 84, contrib: 14, noise: 16, redun: 10 },
    { name: 'BTC/ETH Asset Correlation', category: 'CORRELATION', power: 75, contrib: 10, noise: 15, redun: 30 },
    { name: 'Hourly Seasonality Pattern', category: 'SEASONALITY', power: 62, contrib: 8, noise: 40, redun: 35 },
  ];

  return factors.map((f) => ({
    factorName: f.name,
    category: f.category,
    predictivePower: f.power,
    contribution: f.contrib,
    noiseScore: f.noise,
    redundancyScore: f.redun,
  }));
}
