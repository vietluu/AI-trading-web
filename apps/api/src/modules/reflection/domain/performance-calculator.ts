import type { PerformanceMetrics, PerformanceRecord } from '@platform/shared';

export type Decision = 'LONG' | 'SHORT' | 'WAIT';

export function evaluateDecision(
  decision: Decision,
  priceAtDecision: number,
  priceAfter: number,
  roundTripCostPct = 0,
): Pick<PerformanceRecord, 'outcome' | 'returnPct'> {
  if (!Number.isFinite(priceAtDecision) || priceAtDecision <= 0 || !Number.isFinite(priceAfter) || priceAfter <= 0) {
    throw new Error('Prices must be finite positive numbers');
  }
  if (decision === 'WAIT') return { outcome: 'NEUTRAL', returnPct: 0 };
  const marketReturn = ((priceAfter - priceAtDecision) / priceAtDecision) * 100;
  const grossReturn = decision === 'LONG' ? marketReturn : -marketReturn;
  const returnPct = grossReturn - Math.max(0, roundTripCostPct);
  return {
    outcome: returnPct > 0 ? 'CORRECT' : returnPct < 0 ? 'WRONG' : 'NEUTRAL',
    returnPct: round(returnPct),
  };
}

export function calculatePerformanceMetrics(records: PerformanceRecord[]): PerformanceMetrics {
  const directional = records.filter((record) => record.decision !== 'WAIT');
  const wins = directional.filter((record) => record.outcome === 'CORRECT').length;
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const record of [...records].sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt))) {
    equity += record.returnPct;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return {
    total: records.length,
    directionalDecisions: directional.length,
    winRate: directional.length ? round((wins / directional.length) * 100) : 0,
    accuracy: directional.length ? round((wins / directional.length) * 100) : 0,
    averageReturn: records.length ? round(records.reduce((sum, record) => sum + record.returnPct, 0) / records.length) : 0,
    maxDrawdown: round(maxDrawdown),
    confidenceAccuracyCorrelation: pearson(
      directional.filter((r) => r.outcome !== 'NEUTRAL').map((r) => r.confidence),
      directional.filter((r) => r.outcome !== 'NEUTRAL').map((r) => r.outcome === 'CORRECT' ? 1 : 0),
    ),
    decisionDistribution: {
      LONG: records.filter((r) => r.decision === 'LONG').length,
      SHORT: records.filter((r) => r.decision === 'SHORT').length,
      WAIT: records.filter((r) => r.decision === 'WAIT').length,
    },
    horizonDistribution: {
      M15: records.filter((r) => r.horizon === 'M15').length,
      M30: records.filter((r) => r.horizon === 'M30').length,
      SHORT: records.filter((r) => r.horizon === 'SHORT').length,
      MID: records.filter((r) => r.horizon === 'MID').length,
      H2: records.filter((r) => r.horizon === 'H2').length,
      H4: records.filter((r) => r.horizon === 'H4').length,
      LONG: records.filter((r) => r.horizon === 'LONG').length,
    },
  };
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const numerator = xs.reduce((sum, x, index) => sum + (x - mx) * (ys[index]! - my), 0);
  const dx = Math.sqrt(xs.reduce((sum, x) => sum + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((sum, y) => sum + (y - my) ** 2, 0));
  return dx && dy ? round(numerator / (dx * dy)) : null;
}

function round(value: number): number { return Math.round(value * 10_000) / 10_000; }
