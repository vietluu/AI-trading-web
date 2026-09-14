import type { ConfluenceSignal } from './confluence-engine.types';

export interface AnchorCandle {
  symbol?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  timestamp?: Date | string | number;
  closed?: boolean;
}

export interface AnchorContext {
  available: boolean;
  symbol?: string;
  trend?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  volatility?: 'LOW' | 'NORMAL' | 'HIGH';
  lastClose?: number;
  changePct?: number;
}

export interface MarketContext {
  anchors: {
    BTC: AnchorContext;
    ETH: AnchorContext;
    [key: string]: AnchorContext;
  };
  marketRegime?: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
  timestamp?: Date;
}

export interface OpportunityCandidate extends ConfluenceSignal {
  triggerId?: string;
  setup?: string;
  sourceDataCutoff?: Date | string;
  locationScore?: number;
  expectedNetR?: number;
}

/**
 * Builds anchor trend, volatility, and correlation state strictly from closed candles.
 * BTC and ETH act as risk-on/risk-off market anchors for all opportunities.
 */
export function buildMarketContext(
  input: AnchorCandle[] | Record<string, AnchorCandle[]>,
): MarketContext {
  let btcCandles: AnchorCandle[] = [];
  let ethCandles: AnchorCandle[] = [];

  if (Array.isArray(input)) {
    for (const c of input) {
      const sym = (c.symbol ?? '').toUpperCase();
      if (sym.includes('BTC')) btcCandles.push(c);
      else if (sym.includes('ETH')) ethCandles.push(c);
    }
  } else if (input && typeof input === 'object') {
    for (const [key, val] of Object.entries(input)) {
      const sym = key.toUpperCase();
      const list = Array.isArray(val) ? val : [];
      if (sym.includes('BTC')) btcCandles.push(...list);
      else if (sym.includes('ETH')) ethCandles.push(...list);
    }
  }

  // Filter only closed candles
  btcCandles = btcCandles.filter((c) => c.closed !== false);
  ethCandles = ethCandles.filter((c) => c.closed !== false);

  const evaluateAnchor = (candles: AnchorCandle[], defaultSym: string): AnchorContext => {
    if (candles.length === 0) {
      return { available: false, symbol: defaultSym };
    }
    const last = candles[candles.length - 1]!;
    const first = candles[0]!;
    const changePct = first.open > 0 ? (last.close - first.open) / first.open : 0;
    const trend = changePct > 0.002 ? 'BULLISH' : changePct < -0.002 ? 'BEARISH' : 'NEUTRAL';
    const rangeRatio = last.close > 0 ? (last.high - last.low) / last.close : 0;
    const volatility = rangeRatio > 0.03 ? 'HIGH' : rangeRatio < 0.008 ? 'LOW' : 'NORMAL';

    return {
      available: true,
      symbol: last.symbol ?? defaultSym,
      trend,
      volatility,
      lastClose: last.close,
      changePct: Number((changePct * 100).toFixed(2)),
    };
  };

  const btc = evaluateAnchor(btcCandles, 'BTC-USDT');
  const eth = evaluateAnchor(ethCandles, 'ETH-USDT');

  let marketRegime: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL' = 'NEUTRAL';
  if (btc.trend === 'BULLISH' && eth.trend === 'BULLISH') marketRegime = 'RISK_ON';
  else if (btc.trend === 'BEARISH' && eth.trend === 'BEARISH') marketRegime = 'RISK_OFF';

  return {
    anchors: {
      BTC: btc,
      ETH: eth,
    },
    marketRegime,
    timestamp: new Date(),
  };
}

/**
 * Deterministically ranks candidates across symbols:
 * post-cost expected R, location score, trigger freshness, evidence quality, and correlation penalty.
 * Ties broken by cutoff descending then symbol ascending.
 */
export function rankOpportunities(
  candidates: OpportunityCandidate[],
  options?: { anchorContext?: MarketContext },
): OpportunityCandidate[] {
  return [...candidates].sort((a, b) => {
    const scoreA = calculateRankScore(a, options?.anchorContext);
    const scoreB = calculateRankScore(b, options?.anchorContext);

    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }

    const cutoffA = a.sourceDataCutoff ? new Date(a.sourceDataCutoff).getTime() : 0;
    const cutoffB = b.sourceDataCutoff ? new Date(b.sourceDataCutoff).getTime() : 0;
    if (cutoffB !== cutoffA) {
      return cutoffB - cutoffA;
    }

    return a.symbol.localeCompare(b.symbol);
  });
}

function calculateRankScore(c: OpportunityCandidate, market?: MarketContext): number {
  const expectedR = c.expectedNetR ?? c.expectedValue ?? 0;
  const location = (c.locationScore ?? 50) / 100;
  const evidenceQuality = (c.compositeScore ?? c.confidence ?? 50) / 100;

  let score = expectedR * 100 + location * 30 + evidenceQuality * 20;

  if (market?.marketRegime) {
    if (market.marketRegime === 'RISK_ON' && c.decision === 'SHORT') {
      score -= 10;
    } else if (market.marketRegime === 'RISK_OFF' && c.decision === 'LONG') {
      score -= 10;
    } else if (
      (market.marketRegime === 'RISK_ON' && c.decision === 'LONG') ||
      (market.marketRegime === 'RISK_OFF' && c.decision === 'SHORT')
    ) {
      score += 5;
    }
  }

  return score;
}
