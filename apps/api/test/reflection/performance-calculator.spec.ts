import { describe, expect, it } from 'vitest';
import type { PerformanceRecord } from '@platform/shared';
import { calculatePerformanceMetrics, evaluateDecision } from '../../src/modules/reflection/domain/performance-calculator';

describe('performance evaluation', () => {
  it('evaluates LONG, SHORT and WAIT without executing anything', () => {
    expect(evaluateDecision('LONG', 100, 110)).toEqual({ outcome: 'CORRECT', returnPct: 10 });
    expect(evaluateDecision('SHORT', 100, 90)).toEqual({ outcome: 'CORRECT', returnPct: 10 });
    expect(evaluateDecision('SHORT', 100, 110)).toEqual({ outcome: 'WRONG', returnPct: -10 });
    expect(evaluateDecision('WAIT', 100, 200)).toEqual({ outcome: 'NEUTRAL', returnPct: 0 });
  });

  it('calculates virtual performance, distribution and drawdown', () => {
    const base = { id: crypto.randomUUID(), runId: crypto.randomUUID(), symbol: 'BTC-USDT', horizon: 'SHORT' as const, confidence: 70, priceAtDecision: 100, priceAfter: 110, evaluatedAt: new Date().toISOString() };
    const records: PerformanceRecord[] = [
      { ...base, decision: 'LONG', outcome: 'CORRECT', returnPct: 10 },
      { ...base, id: crypto.randomUUID(), runId: crypto.randomUUID(), decision: 'LONG', outcome: 'WRONG', returnPct: -15, confidence: 50 },
      { ...base, id: crypto.randomUUID(), runId: crypto.randomUUID(), decision: 'WAIT', outcome: 'NEUTRAL', returnPct: 0 },
    ];
    const metrics = calculatePerformanceMetrics(records);
    expect(metrics.winRate).toBe(50);
    expect(metrics.averageReturn).toBeCloseTo(-1.6667);
    expect(metrics.maxDrawdown).toBe(15);
    expect(metrics.decisionDistribution).toEqual({ LONG: 2, SHORT: 0, WAIT: 1 });
    expect(metrics.confidenceAccuracyCorrelation).toBe(1);
  });
});
