import { describe, expect, it } from 'vitest';
import { evaluateShadowPlan, type ShadowCandle, type ShadowPlanEvaluationInput } from '../../src/modules/pipeline/domain/shadow-fill-engine';

describe('evaluateShadowPlan', () => {
  const plan: ShadowPlanEvaluationInput = {
    evaluationKey: 'f'.repeat(64),
    symbol: 'BTC-USDT',
    direction: 'LONG',
    entryPrice: 100_000,
    stopLoss: 98_000,
    targets: [{ price: 104_000, fraction: 1 }],
    sourceDataCutoff: '2026-09-14T01:00:00.000Z',
    expiresAt: '2026-09-14T02:00:00.000Z',
    feeBps: 10,      // 0.10% round trip
    slippageBps: 5,  // 0.05%
    fundingBps: 2,   // 0.02% per duration
    quantity: 1,
  };

  it('handles never-filled limit expiry', () => {
    const candles: ShadowCandle[] = [
      { openTime: Date.parse('2026-09-14T01:15:00.000Z'), open: 101_000, high: 102_000, low: 100_500, close: 101_500 },
      { openTime: Date.parse('2026-09-14T01:30:00.000Z'), open: 101_500, high: 103_000, low: 100_200, close: 102_500 },
      { openTime: Date.parse('2026-09-14T02:00:00.000Z'), open: 102_500, high: 103_000, low: 101_000, close: 102_000 },
    ];

    const outcome = evaluateShadowPlan(plan, candles);
    expect(outcome.status).toBe('EXPIRED');
    expect(outcome.terminalReason).toBe('EXPIRED_UNFILLED');
    expect(outcome.grossPnl).toBe(0);
    expect(outcome.netPnl).toBe(0);
    expect(outcome.netR).toBe(0);
    expect(outcome.isComplete).toBe(true);
  });

  it('evaluates fill then stop loss', () => {
    const candles: ShadowCandle[] = [
      // Fills at 100,000
      { openTime: Date.parse('2026-09-14T01:15:00.000Z'), open: 100_500, high: 101_000, low: 99_800, close: 100_200 },
      // Dips below stop loss (98,000)
      { openTime: Date.parse('2026-09-14T01:30:00.000Z'), open: 100_200, high: 100_400, low: 97_500, close: 97_800 },
    ];

    const outcome = evaluateShadowPlan(plan, candles);
    expect(outcome.status).toBe('STOPPED');
    expect(outcome.terminalReason).toBe('STOP_LOSS');
    expect(outcome.grossPnl).toBe(-2000); // 98,000 - 100,000
    expect(outcome.netPnl).toBeLessThan(-2000); // fees/slippage added to loss
    expect(outcome.netR).toBeLessThan(-1.0);
    expect(outcome.mae).toBeLessThanOrEqual(-2000);
    expect(outcome.isComplete).toBe(true);
  });

  it('evaluates fill then target reached', () => {
    const candles: ShadowCandle[] = [
      // Fills at 100,000
      { openTime: Date.parse('2026-09-14T01:15:00.000Z'), open: 100_500, high: 101_000, low: 99_800, close: 100_200 },
      // Reaches target (104,000)
      { openTime: Date.parse('2026-09-14T01:30:00.000Z'), open: 100_200, high: 104_500, low: 99_900, close: 104_100 },
    ];

    const outcome = evaluateShadowPlan(plan, candles);
    expect(outcome.status).toBe('TARGET_REACHED');
    expect(outcome.terminalReason).toBe('TAKE_PROFIT');
    expect(outcome.grossPnl).toBe(4000); // 104,000 - 100,000
    expect(outcome.netPnl).toBeLessThan(4000); // reduced by costs
    expect(outcome.netPnl).toBeGreaterThan(3500);
    expect(outcome.netR).toBeGreaterThan(1.8);
    expect(outcome.mfe).toBeGreaterThanOrEqual(4000);
    expect(outcome.isComplete).toBe(true);
  });

  it('applies conservative stop-first rule when stop and target are breached in the same candle', () => {
    const candles: ShadowCandle[] = [
      // Fills at 100,000
      { openTime: Date.parse('2026-09-14T01:15:00.000Z'), open: 100_500, high: 100_800, low: 99_500, close: 100_100 },
      // Wild candle: low hits 97,000 (stop is 98,000) AND high hits 105,000 (target is 104,000)
      { openTime: Date.parse('2026-09-14T01:30:00.000Z'), open: 100_100, high: 105_000, low: 97_000, close: 104_500 },
    ];

    const outcome = evaluateShadowPlan(plan, candles);
    // Must trigger STOP_LOSS conservatively
    expect(outcome.status).toBe('STOPPED');
    expect(outcome.terminalReason).toBe('STOP_LOSS');
    expect(outcome.grossPnl).toBe(-2000);
    expect(outcome.isComplete).toBe(true);
  });

  it('deducts fees, slippage, and funding accurately', () => {
    const candles: ShadowCandle[] = [
      { openTime: Date.parse('2026-09-14T01:15:00.000Z'), open: 100_500, high: 101_000, low: 99_800, close: 100_200 },
      { openTime: Date.parse('2026-09-14T01:30:00.000Z'), open: 100_200, high: 104_000, low: 100_000, close: 104_000 },
    ];

    const outcome = evaluateShadowPlan(plan, candles);
    expect(outcome.feeCost).toBeGreaterThan(0);
    expect(outcome.slippageCost).toBeGreaterThan(0);
    expect(outcome.fundingCost).toBeGreaterThan(0);
    expect(outcome.netPnl).toBe(outcome.grossPnl - outcome.feeCost - outcome.slippageCost - outcome.fundingCost);
  });

  it('marks incomplete data if history ends while position is open', () => {
    const candles: ShadowCandle[] = [
      // Fills at 100,000
      { openTime: Date.parse('2026-09-14T01:15:00.000Z'), open: 100_500, high: 101_000, low: 99_800, close: 100_200 },
      // Position still open, no stop or target hit
      { openTime: Date.parse('2026-09-14T01:30:00.000Z'), open: 100_200, high: 102_000, low: 100_000, close: 101_500 },
    ];

    const outcome = evaluateShadowPlan(plan, candles);
    expect(outcome.status).toBe('FILLED');
    expect(outcome.terminalReason).toBe('INCOMPLETE_DATA');
    expect(outcome.isComplete).toBe(false);
    expect(outcome.grossPnl).toBe(1500); // mark to market 101,500 - 100,000
  });
});
