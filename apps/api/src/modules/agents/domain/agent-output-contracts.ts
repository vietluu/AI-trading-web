import { AgentType } from './enums';

const CONTRACTS: Partial<Record<AgentType, string>> = {
  [AgentType.MARKET_ANALYST]: [
    'Return exactly this JSON shape:',
    '{"summary":string,"trend":{"direction":"UP|DOWN|SIDEWAYS","strength":"WEAK|MODERATE|STRONG"},"volatility":{"level":"LOW|MEDIUM|HIGH","atr"?:string},"liquidity":{"bidAskSpread"?:string,"depthImbalance"?:"BUY_HEAVY|SELL_HEAVY|BALANCED"},"derivatives":{"fundingRate"?:string,"fundingTrend"?:"INCREASING|DECREASING|STABLE","openInterest"?:string,"oiTrend"?:"INCREASING|DECREASING|STABLE"},"anomalies":string[],"dataQuality":"GOOD|PARTIAL|INSUFFICIENT","usedTools":string[],"generatedAt":ISO-8601-string}.',
  ].join(' '),
  [AgentType.TECHNICAL_ANALYST]: [
    'Return exactly this JSON shape:',
    '{"summary":string,"trend":{"direction":"UP|DOWN|SIDEWAYS","strength":"WEAK|MODERATE|STRONG"},"momentum":{"rsi":string,"rsiState":"OVERBOUGHT|OVERSOLD|NEUTRAL","macd":{"trend":"BULLISH|BEARISH|NEUTRAL","crossover"?:"BULLISH|BEARISH|NONE"}},"movingAverages":{"alignment":"BULLISH|BEARISH|MIXED","pricePosition":"ABOVE|BELOW|INSIDE"},"volatility":{"atr"?:string,"bollinger":{"position":"UPPER|MIDDLE|LOWER","squeeze":boolean}},"structure":{"marketStructure":"HH_HL|LH_LL|LL_LH|RANGE","breakout"?:boolean},"divergence":{"rsiDivergence":"BULLISH|BEARISH|NONE","macdDivergence":"BULLISH|BEARISH|NONE"},"signals":string[],"dataQuality":"GOOD|PARTIAL|INSUFFICIENT","usedTools":string[],"generatedAt":ISO-8601-string}. Always include divergence and use NONE when divergence is not supported by the supplied data.',
  ].join(' '),
  [AgentType.NEWS_ANALYST]: [
    'Return exactly this JSON shape:',
    '{"summary":string,"impact":{"level":"LOW|MEDIUM|HIGH","direction":"POSITIVE|NEGATIVE|NEUTRAL"},"keyEvents":[{"title":string,"impact":"POSITIVE|NEGATIVE|NEUTRAL","importance":number-0-to-100}],"themes":string[],"riskSignals":string[],"dataQuality":"GOOD|PARTIAL|INSUFFICIENT","usedTools":string[],"generatedAt":ISO-8601-string}.',
  ].join(' '),
  [AgentType.SENTIMENT_ANALYST]: [
    'Return exactly this JSON shape:',
    '{"summary":string,"sentiment":{"overall":"BULLISH|BEARISH|NEUTRAL","intensity":"LOW|MEDIUM|HIGH"},"crowdBehavior":{"fomo":boolean,"panic":boolean,"euphoria":boolean},"sources":{"social"?:string,"marketSentimentIndex"?:string},"anomalies":string[],"dataQuality":"GOOD|PARTIAL|INSUFFICIENT","usedTools":string[],"generatedAt":ISO-8601-string}.',
  ].join(' '),
  [AgentType.MACRO_ANALYST]: [
    'Return exactly this JSON shape:',
    '{"summary":string,"macroTrend":"RISK_ON|RISK_OFF|NEUTRAL","keyEvents":string[],"riskFactors":string[],"dataQuality":"GOOD|PARTIAL|INSUFFICIENT","generatedAt":ISO-8601-string}.',
  ].join(' '),
  [AgentType.ON_CHAIN_ANALYST]: [
    'Return exactly this JSON shape:',
    '{"summary":string,"activity":"HIGH|NORMAL|LOW","flows":{"exchangeInflow"?:string,"exchangeOutflow"?:string},"signals":string[],"dataQuality":"GOOD|PARTIAL|INSUFFICIENT","generatedAt":ISO-8601-string}.',
  ].join(' '),
};

export function getAgentOutputContract(agentType: AgentType): string {
  const contract =
    CONTRACTS[agentType] ??
    'Return one JSON object matching the registered output schema exactly.';
  return `${contract} A | separates allowed enum choices: choose exactly one value and never return the | character. Do not add undeclared keys.`;
}
