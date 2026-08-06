import { describe, expect, it } from 'vitest';
import { SyntheticSimulationService } from '../../src/modules/research/application/synthetic-simulation.service';

describe('synthetic simulation platform', () => {
  it('builds a local-only suite with 300 scenarios covering the requested families', () => {
    const service = new SyntheticSimulationService();
    const dashboard = service.getDashboard();

    expect(dashboard.scenarioCount).toBe(300);
    expect(dashboard.localOnly).toBe(true);
    expect(dashboard.categoryBreakdown).toEqual(
      expect.objectContaining({
        BULL: expect.any(Number),
        BEAR: expect.any(Number),
        SIDEWAY: expect.any(Number),
        BREAKOUT: expect.any(Number),
        FAKE_BREAKOUT: expect.any(Number),
        FLASH_CRASH: expect.any(Number),
        NEWS_SHOCK: expect.any(Number),
        FUNDING_EXTREMES: expect.any(Number),
        ORDERBOOK_ANOMALIES: expect.any(Number),
        API_FAILURES: expect.any(Number),
        DATA_CORRUPTION: expect.any(Number),
        BOUNDARY_CONDITIONS: expect.any(Number),
        ACCUMULATION: expect.any(Number),
        DISTRIBUTION: expect.any(Number),
        LIQUIDITY_SWEEP: expect.any(Number),
        OPEN_INTEREST_EXPANSION: expect.any(Number),
        OPEN_INTEREST_COLLAPSE: expect.any(Number),
        WHALE_ACTIVITY: expect.any(Number),
        MACRO_EVENT: expect.any(Number),
        ETF_FLOW: expect.any(Number),
        EXCHANGE_FAILURE: expect.any(Number),
        NETWORK_FAILURE: expect.any(Number),
        LOW_LIQUIDITY: expect.any(Number),
        HIGH_SPREAD: expect.any(Number),
        MARKET_MANIPULATION: expect.any(Number),
      }),
    );
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
