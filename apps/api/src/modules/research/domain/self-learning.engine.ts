export interface TradePostMortemInsight {
  insightType: 'WINNING_PATTERN' | 'LOSING_PATTERN' | 'FALSE_POSITIVE' | 'FALSE_NEGATIVE' | 'MISSED_OPPORTUNITY';
  tradeSymbol?: string;
  summary: string;
  evidence: Record<string, unknown>;
  recommendation: string;
}

export function generateSelfLearningInsights(): TradePostMortemInsight[] {
  return [
    {
      insightType: 'WINNING_PATTERN',
      tradeSymbol: 'BTC-USDT',
      summary: 'High agreement between Market, Technical, and On-chain Whale Outflow produced 89% win-rate.',
      evidence: { agreementScore: 100, onchainFlow: 'NET_OUTFLOW', profitFactor: 3.4 },
      recommendation: 'Increase position size multiplier by 1.1x when On-Chain Net Outflow aligns with Technical trend.',
    },
    {
      insightType: 'FALSE_POSITIVE',
      tradeSymbol: 'ETH-USDT',
      summary: 'Breakout signal failed during High Volatility news events.',
      evidence: { newsImpact: 'HIGH', volatilityLevel: 'HIGH', outcome: 'STOP_LOSS' },
      recommendation: 'Enforce WAIT filter 15 minutes before and after high-impact macro news announcements.',
    },
    {
      insightType: 'MISSED_OPPORTUNITY',
      tradeSymbol: 'SOL-USDT',
      summary: 'Strong trend breakout skipped due to overly strict confidence threshold (confidence 58% vs threshold 60%).',
      evidence: { confidence: 58, adaptiveThreshold: 60, prospectiveProfitPct: 8.5 },
      recommendation: 'Implement adaptive threshold reduction (-4%) when Market Regime is strongly TRENDING.',
    },
  ];
}
