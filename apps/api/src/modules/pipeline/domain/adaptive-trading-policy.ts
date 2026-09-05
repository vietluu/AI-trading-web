import type { MarketRegime } from '@platform/shared';

export type AssetLiquidityClass = 'MAJOR' | 'LIQUID_ALT' | 'LONG_TAIL';

export interface AdaptivePolicyContext {
  symbol?: string;
  provider?: 'BINANCE_FUTURES' | 'OKX_FUTURES';
  timeframe?: string;
  regime?: MarketRegime['type'];
  spreadBps?: number;
}

const MAJORS = new Set(['BTC', 'ETH']);
const LIQUID_ALTS = new Set(['SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK']);

export function assetLiquidityClass(symbol?: string): AssetLiquidityClass {
  if (!symbol) return 'MAJOR';
  const base = symbol.toUpperCase().split('-')[0] ?? '';
  return MAJORS.has(base) ? 'MAJOR' : LIQUID_ALTS.has(base) ? 'LIQUID_ALT' : 'LONG_TAIL';
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
  const regime = context.regime ?? 'RANGING';
  const timeframeMs = timeframeMilliseconds(context.timeframe);
  const classRisk = liquidityClass === 'MAJOR' ? 0 : liquidityClass === 'LIQUID_ALT' ? 1 : 2;
  const volatilityRisk = regime === 'HIGH_VOLATILITY' ? 2 : regime === 'RANGING' ? 1 : 0;
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
  const maxRsiLong = regime === 'TRENDING' ? 85 : regime === 'RANGING' ? 75 : 72;
  const minRsiShort = regime === 'TRENDING' ? 15 : regime === 'RANGING' ? 25 : 28;

  return {
    liquidityClass,
    executionCostMultiplier,
    minColdStartConfidence,
    minColdStartOpportunity,
    maxRsiLong,
    minRsiShort,
    staleAfterMs: Math.round(Math.max(2 * 60_000, Math.min(30 * 60_000, timeframeMs * 2)) / (regime === 'HIGH_VOLATILITY' ? 1.5 : 1)),
    minExpectedValue: Number((0.08 + totalRisk * 0.025).toFixed(3)),
    minProfitFactor: Number((1.15 + totalRisk * 0.04).toFixed(2)),
    minCalibratedProbability: Number((0.51 + totalRisk * 0.008).toFixed(3)),
    maxRiskScore: Math.round(88 - totalRisk * 2.5),
    minAtrPercent: timeframeAtrBase * (1 + classRisk * 0.2 + volatilityRisk * 0.1),
    minVolumeChangePercent: liquidityClass === 'MAJOR' ? 0.35 : liquidityClass === 'LIQUID_ALT' ? 0.7 : 1.2,
    maxSpreadBps: liquidityClass === 'MAJOR' ? 8 : liquidityClass === 'LIQUID_ALT' ? 15 : 25,
  };
}
