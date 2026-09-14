import { describe, expect, it } from 'vitest';
import {
  evaluateRecoveryCohort,
  type RecoveryOutcomeRecord,
} from '../../src/modules/reflection/domain/recovery-cohort-evaluation';

describe('evaluateRecoveryCohort', () => {
  function makeOutcome(
    id: string,
    key: string,
    grossPnl: number,
    cost: number,
    netR: number,
    terminalReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'EXPIRED_UNFILLED',
    overrides: Partial<RecoveryOutcomeRecord> = {},
  ): RecoveryOutcomeRecord {
    const feeCost = cost * 0.5;
    const slippageCost = cost * 0.3;
    const fundingCost = cost * 0.2;
    const netPnl = grossPnl - cost;

    return {
      id,
      evaluationKey: key,
      symbol: 'BTC-USDT',
      provider: 'BINANCE_FUTURES',
      timeframe: '15m',
      direction: 'LONG',
      setup: 'RECOVERY_RECLAIM',
      cohortKey: 'BINANCE_FUTURES:BTC-USDT:15m:RECOVERY_RECLAIM:IMMATURE',
      status: terminalReason === 'TAKE_PROFIT' ? 'TARGET_REACHED' : terminalReason === 'STOP_LOSS' ? 'STOPPED' : 'EXPIRED',
      isComplete: true,
      isSuperseded: false,
      grossPnl,
      feeCost,
      slippageCost,
      fundingCost,
      netPnl,
      netR,
      mfe: grossPnl > 0 ? grossPnl + 100 : 50,
      mae: grossPnl < 0 ? grossPnl - 50 : -50,
      terminalReason,
      createdAt: '2026-09-14T01:00:00.000Z',
      ...overrides,
    };
  }

  it('reconciles grossPnl - costs = netPnl and computes core metrics accurately', () => {
    const records: RecoveryOutcomeRecord[] = [
      makeOutcome('1', 'k1', 200, 20, 1.8, 'TAKE_PROFIT'),
      makeOutcome('2', 'k2', 200, 20, 1.8, 'TAKE_PROFIT'),
      makeOutcome('3', 'k3', -100, 20, -1.2, 'STOP_LOSS'),
      makeOutcome('4', 'k4', -100, 20, -1.2, 'STOP_LOSS'),
    ];

    const report = evaluateRecoveryCohort(records);
    expect(report.sampleSize).toBe(4);
    expect(report.winCount).toBe(2);
    expect(report.lossCount).toBe(2);
    expect(report.winRate).toBe(0.5);
    // net profits: 180, 180. net losses: 120, 120. grossProfit: 360, grossLoss: 240. PF: 1.5
    expect(report.profitFactor).toBe(1.5);
    // meanNetR: (1.8 + 1.8 - 1.2 - 1.2) / 4 = 1.2 / 4 = 0.3
    expect(report.meanNetR).toBe(0.3);
    expect(report.lowerConfidenceBoundNetR).toBeDefined();
    expect(report.stopBeforeTargetRate).toBe(0.5);
  });

  it('deduplicates duplicate evaluation keys and tracks explicit exclusion counts', () => {
    const records: RecoveryOutcomeRecord[] = [
      makeOutcome('1', 'k1', 200, 20, 1.8, 'TAKE_PROFIT'),
      makeOutcome('2', 'k1', 200, 20, 1.8, 'TAKE_PROFIT'), // duplicate key
      makeOutcome('3', 'k2', 200, 20, 1.8, 'TAKE_PROFIT', { isComplete: false }), // incomplete
      makeOutcome('4', 'k3', 200, 20, 1.8, 'TAKE_PROFIT', { isSuperseded: true }), // superseded
      makeOutcome('5', 'k4', null as unknown as number, 20, null as unknown as number, 'TAKE_PROFIT'), // corrupted/missing
    ];

    const report = evaluateRecoveryCohort(records);
    expect(report.sampleSize).toBe(1);
    expect(report.exclusions.duplicateCount).toBe(1);
    expect(report.exclusions.incompleteCount).toBe(1);
    expect(report.exclusions.supersededCount).toBe(1);
    expect(report.exclusions.corruptedCount).toBe(1);
  });

  it('calculates max drawdown, MFE/MAE, and doubled-cost sensitivity accurately', () => {
    const records: RecoveryOutcomeRecord[] = [
      makeOutcome('1', 'k1', 100, 10, 0.9, 'TAKE_PROFIT'), // net 90, cum 90, peak 90, dd 0
      makeOutcome('2', 'k2', -100, 10, -1.1, 'STOP_LOSS'), // net -110, cum -20, peak 90, dd 110
      makeOutcome('3', 'k3', -100, 10, -1.1, 'STOP_LOSS'), // net -110, cum -130, peak 90, dd 220
      makeOutcome('4', 'k4', 200, 10, 1.9, 'TAKE_PROFIT'), // net 190, cum 60, peak 90, dd 30
    ];

    const report = evaluateRecoveryCohort(records);
    expect(report.maxDrawdown).toBe(220);
    expect(report.averageMfe).toBeGreaterThan(0);
    expect(report.averageMae).toBeLessThan(0);

    // Doubled costs: cost becomes 20 per trade.
    // Trade 1: 100 - 20 = 80
    // Trade 2: -100 - 20 = -120
    // Trade 3: -100 - 20 = -120
    // Trade 4: 200 - 20 = 180
    // GrossProfit: 260, GrossLoss: 240, PF: 260/240 = 1.0833
    expect(report.sensitivity.doubledCostProfitFactor).toBeCloseTo(1.0833, 3);
    expect(report.sensitivity.doubledCostResilient).toBe(true);
  });

  it('handles empty input and zero denominators safely without NaN', () => {
    const report = evaluateRecoveryCohort([]);
    expect(report.sampleSize).toBe(0);
    expect(report.winRate).toBe(0);
    expect(report.profitFactor).toBe(0);
    expect(report.meanNetR).toBe(0);
    expect(report.lowerConfidenceBoundNetR).toBe(0);
    expect(report.maxDrawdown).toBe(0);
    expect(report.stopBeforeTargetRate).toBe(0);
  });
});
