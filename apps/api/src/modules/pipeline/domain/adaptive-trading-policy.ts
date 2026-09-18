import type { MarketRegime } from '@platform/shared';

export type AssetLiquidityClass = 'MAJOR' | 'LIQUID_ALT' | 'LONG_TAIL';

export interface AdaptivePolicyContext {
  symbol?: string;
  provider?: 'BINANCE_FUTURES' | 'OKX_FUTURES';
  timeframe?: string;
  regime?: MarketRegime['type'] | 'BREAKOUT';
  spreadBps?: number;
  riskRewardRatio?: number;
  directionalAgreement?: number;
}


const MAJORS = new Set(['BTC', 'ETH']);
const LIQUID_ALTS = new Set([
  'SOL',
  'BNB',
  'XRP',
  'DOGE',
  'ADA',
  'AVAX',
  'LINK',
  'ARB',
  'OP',
  'SUI',
  'APT',
  'NEAR',
  'TIA',
]);

export function assetLiquidityClass(symbol?: string): AssetLiquidityClass {
  if (!symbol) return 'MAJOR';
  const base = symbol.toUpperCase().split('-')[0] ?? '';
  return MAJORS.has(base) ? 'MAJOR' : LIQUID_ALTS.has(base) ? 'LIQUID_ALT' : 'LONG_TAIL';
}

export function isMajorAsset(symbol?: string): boolean {
  return assetLiquidityClass(symbol) === 'MAJOR';
}

export function isAltcoin(symbol?: string): boolean {
  return assetLiquidityClass(symbol) !== 'MAJOR';
}

export function timeframeMilliseconds(timeframe = '15m'): number {
  const match = /^(\d+)([mhd])$/i.exec(timeframe);
  if (!match) return 15 * 60_000;
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  return amount * (unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000);
}

export function parseSpreadBps(raw: string | undefined, referencePrice?: number): number | undefined {
  if (!raw) return undefined;
  const numeric = Number(raw.replace(/[%,$]/g, '').trim());
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  if (raw.includes('%')) return numeric * 100;
  if (referencePrice && referencePrice > 0) return numeric / referencePrice * 10_000;
  return numeric;
}

export function preferredTradePlanAtr(indicatorAtr: unknown, agentAtr: unknown): number | undefined {
  for (const value of [indicatorAtr, agentAtr]) {
    const normalized = typeof value === 'string'
      ? value.replace(/[$,]/g, '').replace(/\s*(?:USD|USDT)$/i, '').trim()
      : value;
    const numeric = Number(normalized);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return undefined;
}

export function adaptiveTradingPolicy(context: AdaptivePolicyContext) {
  const liquidityClass = assetLiquidityClass(context.symbol);
  const regime: MarketRegime['type'] | 'BREAKOUT' = context.regime ?? 'RANGING';
  const timeframeMs = timeframeMilliseconds(context.timeframe);
  const classRisk = liquidityClass === 'MAJOR' ? 0 : liquidityClass === 'LIQUID_ALT' ? 1 : 2;
  const volatilityRisk = regime === 'HIGH_VOLATILITY' ? 2 : regime === 'RANGING' ? 1 : regime === 'BREAKOUT' ? 1 : 0;
  const providerRisk = context.provider === 'OKX_FUTURES' ? 0.25 : 0;
  const spreadRisk = context.spreadBps === undefined ? 0.5 : Math.min(3, context.spreadBps / 10);
  const totalRisk = classRisk + volatilityRisk + providerRisk + spreadRisk;
  const timeframeMinutes = timeframeMs / 60_000;
  const timeframeAtrBase = timeframeMinutes <= 1 ? 0.025
    : timeframeMinutes <= 5 ? 0.05
      : timeframeMinutes <= 15 ? 0.1
        : timeframeMinutes <= 60 ? 0.18
          : 0.35;
  const executionCostMultiplier = liquidityClass === 'MAJOR' ? 1 : liquidityClass === 'LIQUID_ALT' ? 1.5 : 2.5;
  const minColdStartConfidence = liquidityClass === 'MAJOR' ? 62 : liquidityClass === 'LIQUID_ALT' ? 66 : 70;
  const minColdStartOpportunity = liquidityClass === 'MAJOR' ? 58 : liquidityClass === 'LIQUID_ALT' ? 62 : 66;
  const minOpportunityScore = liquidityClass === 'MAJOR' ? 65 : liquidityClass === 'LIQUID_ALT' ? 72 : 78;
  const minStructuralRiskReward = liquidityClass === 'MAJOR' ? 1.5 : liquidityClass === 'LIQUID_ALT' ? 1.75 : 2.0;
  const maxRsiLong = (regime === 'TRENDING' || regime === 'BREAKOUT') ? 85 : regime === 'RANGING' ? 75 : 72;
  const minRsiShort = (regime === 'TRENDING' || regime === 'BREAKOUT') ? 15 : regime === 'RANGING' ? 25 : 28;


  // Dynamic calibrated probability based on risk:reward and directional consensus
  const effectiveRr = context.riskRewardRatio && context.riskRewardRatio > 0.5
    ? Math.min(3.0, context.riskRewardRatio)
    : 1.5;
  const breakevenProb = 1 / (1 + effectiveRr);
  // Base requirement: breakeven probability + risk buffer
  const baseReq = Math.max(0.48, Math.min(0.53, breakevenProb + 0.06 + totalRisk * 0.005));
  // High consensus discount: when directional agreement is >= 80%, discount up to 0.025
  const agreementDiscount = (context.directionalAgreement && context.directionalAgreement >= 80)
    ? Math.min(0.025, (context.directionalAgreement - 75) * 0.001)
    : 0;
  const minCalibratedProbability = Number(Math.max(0.48, baseReq - agreementDiscount).toFixed(3));

  return {
    liquidityClass,
    executionCostMultiplier,
    minColdStartConfidence,
    minColdStartOpportunity,
    minOpportunityScore,
    minStructuralRiskReward,
    maxRsiLong,
    minRsiShort,
    staleAfterMs: Math.round(Math.max(2 * 60_000, Math.min(30 * 60_000, timeframeMs * 2)) / (regime === 'HIGH_VOLATILITY' ? 1.5 : 1)),
    minExpectedValue: Number((0.08 + totalRisk * 0.025).toFixed(3)),
    minProfitFactor: Number((1.15 + totalRisk * 0.04).toFixed(2)),
    minCalibratedProbability,
    maxRiskScore: Math.round(88 - totalRisk * 2.5),
    minAtrPercent: timeframeAtrBase * (1 + classRisk * 0.2 + volatilityRisk * 0.1),
    minVolumeChangePercent: liquidityClass === 'MAJOR' ? 0.35 : liquidityClass === 'LIQUID_ALT' ? 0.7 : 1.2,
    maxSpreadBps: liquidityClass === 'MAJOR' ? 8 : liquidityClass === 'LIQUID_ALT' ? 15 : 25,
  };
}
