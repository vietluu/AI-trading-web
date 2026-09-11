import { describe, expect, it } from 'vitest';
import type { DecisionOutput, TradeThesis } from '@platform/shared';
import { buildAdaptiveTradePlan } from '../../src/modules/risk/domain/trade-plan-engine';
import { createBaseSnapshot, createValidLongThesis } from '../helpers/thesis-fixture';

function fixture(setup: TradeThesis['setup'] = 'TREND_PULLBACK') {
  const thesis = createValidLongThesis(); thesis.setup = setup; thesis.targets = [{ price: 112000, fraction: 1 }];
  const snapshot = createBaseSnapshot();
  const run = () => buildAdaptiveTradePlan({ symbol: snapshot.symbol, side: 'LONG', entryPrice: 108200,
    decision: { decision: 'LONG', regime: { type: 'RANGING' } } as DecisionOutput,
    market: { proactive: { thesisId: 'thesis-1', thesis, snapshot, mode: 'DEMO', sizeFactor: 1 }, timeframeMs: 900000 },
    configuredStopLossPct: 0.02, configuredRiskRewardRatio: 2 });
  return { thesis, snapshot, run };
}
describe('executable proactive playbooks', () => {
  it('carries exact limit price, deadline, and declared target', () => {
    const { run } = fixture();
    expect(run()).toMatchObject({ approved: true, orderType: 'LIMIT', timeInForce: 'IOC', limitEntryPrice: 108200, expiresAt: '2026-09-09T12:15:00.000Z', targets: [{ price: 112000, fraction: 1 }] });
  });
  it('fails closed for target fractions the exchange execution cannot implement', () => {
    const { thesis, run } = fixture(); thesis.targets = createValidLongThesis().targets;
    expect(run()).toMatchObject({ approved: false, reason: 'THESIS_MULTI_TARGET_EXECUTION_UNSUPPORTED', targets: thesis.targets });
  });
  it('rejects a sweep label without actual reclaimed sweep evidence', () => {
    expect(fixture('LIQUIDITY_SWEEP_REVERSAL').run()).toMatchObject({ approved: false, reason: 'THESIS_SWEEP_EVIDENCE_REQUIRED' });
  });
  it('rejects a squeeze label without compression', () => {
    const { snapshot, run } = fixture('SQUEEZE_PROBE');
    if (snapshot.volatility.coverage === 'AVAILABLE') snapshot.volatility.squeezeState = 'NOT_SQUEEZING';
    expect(run()).toMatchObject({ approved: false, reason: 'THESIS_COMPRESSION_REQUIRED' });
  });
  it('requires independent directional evidence for a squeeze probe', () => {
    expect(fixture('SQUEEZE_PROBE').run()).toMatchObject({ approved: false, reason: 'THESIS_DIRECTIONAL_EVIDENCE_REQUIRED' });
  });
  it('uses aligned derivatives as a second squeeze evidence group', () => {
    const { snapshot, run } = fixture('SQUEEZE_PROBE');
    if (snapshot.derivatives.coverage === 'AVAILABLE' && snapshot.derivatives.derivativesImbalance.coverage === 'AVAILABLE') {
      snapshot.derivatives.derivativesImbalance.squeezeDirection = 'SHORT_SQUEEZE'; snapshot.derivatives.derivativesImbalance.squeezeProbability = 80;
    }
    expect(run().approved).toBe(true);
  });
  it('rejects stale derivatives even when their direction matches', () => {
    const { snapshot, run } = fixture('SQUEEZE_PROBE');
    if (snapshot.derivatives.coverage === 'AVAILABLE' && snapshot.derivatives.derivativesImbalance.coverage === 'AVAILABLE') {
      snapshot.derivatives.derivativesImbalance.squeezeDirection = 'SHORT_SQUEEZE'; snapshot.derivatives.derivativesImbalance.squeezeProbability = 80; snapshot.derivatives.derivativesImbalance.freshness = 'STALE';
    }
    expect(run()).toMatchObject({ approved: false, reason: 'THESIS_DIRECTIONAL_EVIDENCE_REQUIRED' });
  });
  it('consumes snapshot boundaries even when caller omits market support/resistance', () => {
    const { run, snapshot } = fixture('RANGE_REVERSAL');
    if (snapshot.structure.coverage === 'AVAILABLE') snapshot.structure.rangeBoundaries = { lower: 106200, upper: 110200 };
    expect(run()).toMatchObject({ approved: false, reason: 'RANGE_MIDPOINT_ENTRY_BLOCKED' });
  });
});
