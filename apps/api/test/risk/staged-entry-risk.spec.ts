import { describe, expect, it } from "vitest";
import { evaluateRisk } from "../../src/modules/risk/domain/risk-engine";
import type { DecisionOutput } from "@platform/shared";
import type { RiskInput, RiskLimits, RiskPosition } from "../../src/modules/risk/domain/risk-engine.types";

const defaultLimits: RiskLimits = {
  riskPerTrade: 0.005, // 0.50%
  maxPositions: 3,
  maxLeverage: 10,
  maxDrawdown: 0.1,
  maxExposure: 0.5,
  cooldownMs: 0,
  minimumConfidence: 60,
  stopLossPct: 0.02,
  riskRewardRatio: 2,
  highVolatility: 5,
  abnormalVolatility: 10,
  highVolatilitySizeFactor: 0.5,
  estimatedRoundTripCostPct: 0.001,
  maxStopLossRoe: 0.5,
  rangeScalpRoeMultiplier: 1.5,
  minLiquidationBufferPct: 0.01,
};

const getBaseInput = (decision: 'LONG' | 'SHORT', currentPositions: RiskPosition[] = []): RiskInput => ({
  symbol: 'BTC-USDT',
  account: { balance: 10000, equity: 10000, peakEquity: 10000 },
  currentPositions,
  decision: {
    decision,
    confidence: 80,
    regime: { type: 'TRENDING_BULL' },
    expectedValue: 1,
    expectedLoss: 1,
    expectedReward: 2,
    riskScore: 20,
    opportunityScore: 80,
  } as unknown as DecisionOutput,
  marketData: {
    price: 100000,
    volatility: 0.01,
    tradePlanContext: {
      gateSeverity: 'APPROVE', 
      support: 98000,
      resistance: 104000,
      marketStructure: 'HH_HL',
      timeframeMs: 3600000,
      candleClose: 100000,
    },
  },
  now: new Date(),
});

describe('ordinary pipeline regressions', () => {
  it('does not infer a staged probe from gate severity', () => {
    const risk = evaluateRisk(getBaseInput('LONG'), defaultLimits);
    expect(risk.approved).toBe(true);
    expect(risk.tradePlan?.stagedEntry).toBeUndefined();
  });
  it('does not authorize adding to an ordinary position with an APPROVE gate', () => {
    const risk = evaluateRisk(getBaseInput('LONG', [{ symbol: 'BTC-USDT', side: 'LONG', size: 0.005, markPrice: 100000, entryPrice: 100000 }]), defaultLimits);
    expect(risk).toMatchObject({ approved: false, reason: 'PYRAMIDING_NOT_ALLOWED' });
  });
});


import { cutoff, createBaseSnapshot, createValidLongThesis } from '../helpers/thesis-fixture';

function proactiveInput(state: 'PROBE_READY' | 'CONFIRMED' | 'WATCHING' = 'PROBE_READY'): RiskInput {
  const snapshot = createBaseSnapshot();
  const thesis = createValidLongThesis(); thesis.targets = [{ price: 112000, fraction: 1 }];
  thesis.state = state;
  thesis.setup = 'TREND_PULLBACK';
  thesis.trigger = [{ type: 'PRICE_ABOVE', price: 108100, description: 'Declared reclaim' }];
  const input = getBaseInput('LONG');
  input.marketData.price = 108200;
  input.marketData.tradePlanContext = { atr: 200, proactive: { thesisId: 'thesis-1', opportunityId: 'opportunity-1', thesis, snapshot, mode: 'DEMO', sizeFactor: 1 } };
  input.now = new Date(cutoff);
  return input;
}
function probePosition(size = 0.005): RiskPosition {
  return { symbol: 'BTC-USDT', side: 'LONG', size, markPrice: 108200, entryPrice: 108100, stopLoss: 107400, protectionVerified: true,
    stagedEntry: { stage: 'PROBE', thesisId: 'thesis-1', setup: 'TREND_PULLBACK', trigger: [{ type: 'PRICE_ABOVE', price: 108100, description: 'Declared reclaim' }], sourceDataCutoff: '2026-09-09T11:45:00.000Z' } };
}
describe('governed staged theses', () => {
  it('uses the thesis stop and a quarter risk probe', () => {
    const risk = evaluateRisk(proactiveInput(), defaultLimits);
    expect(risk.approved).toBe(true);
    expect(risk.stopLoss).toBe(107400);
    expect(risk.tradePlan?.stagedEntry?.stage).toBe('PROBE');
    expect(risk.plannedEquityRiskPct).toBeLessThanOrEqual(0.00125);
  });
  it('does not execute WATCHING even with a directional thesis', () => {
    expect(evaluateRisk(proactiveInput('WATCHING'), defaultLimits).approved).toBe(false);
  });
  it('requires a stored probe for confirmation', () => {
    expect(evaluateRisk(proactiveInput('CONFIRMED'), defaultLimits).approved).toBe(false);
  });
  it('requires declared trigger satisfaction before adding', () => {
    const input = proactiveInput('CONFIRMED');
    const position = probePosition();
    position.stagedEntry!.trigger[0]!.price = 110000;
    input.currentPositions = [position];
    expect(evaluateRisk(input, defaultLimits).approved).toBe(false);
  });
  it('allows confirmed add with stored probe protection and trigger', () => {
    const input = proactiveInput('CONFIRMED'); input.currentPositions = [probePosition()];
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.approved).toBe(true);
    expect(risk.tradePlan?.stagedEntry?.stage).toBe('CONFIRMED');
  });
  it('includes existing exposure when sizing a confirmation add', () => {
    const input = proactiveInput('CONFIRMED'); input.currentPositions = [probePosition(0.04)];
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.approved).toBe(true);
    expect((0.04 + risk.positionSize!) * 108200 / 10000).toBeLessThanOrEqual(0.500001);
  });
  it.each([undefined, 0, 100000])('rejects missing protection or combined loss using actual stop %s', (stopLoss) => {
    const input = proactiveInput('CONFIRMED'); const position = probePosition(0.04); position.stopLoss = stopLoss; input.currentPositions = [position];
    expect(evaluateRisk(input, defaultLimits).approved).toBe(false);
  });
  it('counts absolute signed quantities and costs in combined loss', () => {
    const input = proactiveInput('CONFIRMED'); const position = probePosition(-0.04); position.stopLoss = 107000; input.currentPositions = [position];
    expect(evaluateRisk(input, defaultLimits).approved).toBe(false);
  });
  it('uses the smaller cohort authority cap without compounding size reductions', () => {
    const full = evaluateRisk(proactiveInput(), defaultLimits);
    const input = proactiveInput(); input.marketData.tradePlanContext!.proactive!.sizeFactor = 0.2;
    const small = evaluateRisk(input, defaultLimits);
    expect(small.approved).toBe(true);
    expect(small.stopLoss).toBe(full.stopLoss);
    expect(small.positionSize!).toBeCloseTo(full.positionSize! * (0.2 / 0.25), 8);
  });
  it('caps a twelve-percent drawdown diagnostic probe at the minimum size factor', () => {
    const normal = evaluateRisk(proactiveInput(), {
      ...defaultLimits,
      maxDrawdown: 0.15,
    });
    const input = proactiveInput();
    input.account = { balance: 10000, equity: 8800, peakEquity: 10000 };
    input.marketData.tradePlanContext!.proactive!.sizeFactor = 0.2;

    const risk = evaluateRisk(input, {
      ...defaultLimits,
      maxDrawdown: 0.15,
    });

    expect(risk.approved).toBe(true);
    expect(risk.tradePlan).toMatchObject({ riskTier: 'PROBE', sizeFactor: 0.1 });
    expect(risk.positionSize!).toBeCloseTo(normal.positionSize! * 0.4, 8);
  });
});
