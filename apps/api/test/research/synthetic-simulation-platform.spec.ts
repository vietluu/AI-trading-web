import { describe, expect, it } from 'vitest';
import { SyntheticSimulationService } from '../../src/modules/research/application/synthetic-simulation.service';

describe('synthetic simulation platform', () => {
  it('builds a local-only suite with 300 scenarios covering the requested families', () => {
    const service = new SyntheticSimulationService();
    const dashboard = service.getDashboard();

    expect(dashboard.scenarioCount).toBe(300);
    expect(dashboard.localOnly).toBe(true);
    const expectedCategories = [
      'BULL',
      'BEAR',
      'SIDEWAY',
      'BREAKOUT',
      'FAKE_BREAKOUT',
      'FLASH_CRASH',
      'NEWS_SHOCK',
      'FUNDING_EXTREMES',
      'ORDERBOOK_ANOMALIES',
      'API_FAILURES',
      'DATA_CORRUPTION',
      'BOUNDARY_CONDITIONS',
      'ACCUMULATION',
      'DISTRIBUTION',
      'LIQUIDITY_SWEEP',
      'OPEN_INTEREST_EXPANSION',
      'OPEN_INTEREST_COLLAPSE',
      'WHALE_ACTIVITY',
      'MACRO_EVENT',
      'ETF_FLOW',
      'EXCHANGE_FAILURE',
      'NETWORK_FAILURE',
      'LOW_LIQUIDITY',
      'HIGH_SPREAD',
      'MARKET_MANIPULATION',
    ] as const;

    expect(Object.keys(dashboard.categoryBreakdown)).toEqual(expect.arrayContaining(expectedCategories));
    expect(Object.values(dashboard.categoryBreakdown).every((value) => typeof value === 'number')).toBe(true);
  });

  it('runs scenarios and produces measurable verification and mutation results', () => {
    const service = new SyntheticSimulationService();
    const result = service.runFullSuite({ limit: 12 });

    expect(result.scenarioResults.length).toBeGreaterThan(0);
    expect(result.summary.totalScenarios).toBeGreaterThan(0);
    expect(result.mutationSummary.totalMutations).toBeGreaterThan(0);
    expect(result.summary.passCount + result.summary.failCount).toBe(result.summary.totalScenarios);
  });

  it('exposes richer statistical validation metrics for walk-forward and monte carlo analysis', () => {
    const service = new SyntheticSimulationService();
    const validation = service.runStatisticalValidation({ limit: 60, iterations: 8 });

    expect(validation.walkForward.averagePassRate).toBeGreaterThan(0);
    expect(validation.walkForward.folds.length).toBeGreaterThan(0);
    expect(validation.monteCarlo.meanPassRate).toBeGreaterThan(0);
    expect(validation.bootstrap.confidenceInterval[0]).toBeLessThanOrEqual(validation.bootstrap.confidenceInterval[1]);
    expect(validation.outOfSample.passRate).toBeGreaterThan(0);
  });
});
