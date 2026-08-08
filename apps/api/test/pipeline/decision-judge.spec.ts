import { describe, expect, it } from 'vitest';
import { DecisionJudgeService } from '../../src/modules/pipeline/application/decision-judge.service';

describe('DecisionJudgeService', () => {
  const judge = new DecisionJudgeService();

  it('requests more data instead of approving synthetic or missing analysis', () => {
    const generatedAt = new Date().toISOString();
    const insufficient = { dataQuality: 'INSUFFICIENT', generatedAt };
    const decision = {
      decision: 'LONG', dataQuality: 'PARTIAL', conflictLevel: 'LOW', confidence: 80,
      expectedValue: 0.8, profitFactorEstimate: 1.8, riskScore: 30,
    };
    const result = judge.evaluate(decision as never, {
      market: insufficient, technical: insufficient, news: insufficient,
      sentiment: insufficient, macro: insufficient, onchain: insufficient,
    } as never);

    expect(result.approved).toBe(false);
    expect(result.verdict).toBe('REQUEST_MORE_DATA');
  });

  it('rejects a directional decision with non-positive edge', () => {
    const generatedAt = new Date().toISOString();
    const good = { dataQuality: 'GOOD', generatedAt };
    const result = judge.evaluate({
      decision: 'LONG', dataQuality: 'GOOD', conflictLevel: 'LOW', confidence: 80,
      expectedValue: 0, profitFactorEstimate: 1.8, riskScore: 30,
    } as never, {
      market: good, technical: good, news: good, sentiment: good, macro: good, onchain: good,
    } as never);

    expect(result).toEqual(expect.objectContaining({ approved: false, verdict: 'REJECT' }));
    expect(result.reasons).toContain('EXPECTED_VALUE_TOO_LOW');
  });
});
