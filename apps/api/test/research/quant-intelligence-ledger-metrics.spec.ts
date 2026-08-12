import { describe, expect, it } from 'vitest';
import {
  calculateLedgerPortfolioMetrics,
  resolveStrategyAllocationTarget,
} from '../../src/modules/research/application/quant-intelligence.service';

describe('calculateLedgerPortfolioMetrics', () => {
  it('calculates portfolio cards from verified closed-trade returns and net PnL', () => {
    const result = calculateLedgerPortfolioMetrics([
      { netPnl: 120, returnPct: 0.04 },
      { netPnl: -40, returnPct: -0.01 },
      { netPnl: 60, returnPct: 0.02 },
    ]);

    expect(result.profitFactor).toBe(4.5);
    expect(result.expectedValuePct).toBe(1.6667);
    expect(result.sharpeRatio).toBeGreaterThan(0);
    expect(result.maxDrawdownPct).toBe(1);
  });

  it('does not manufacture return-based metrics when return data is absent', () => {
    const result = calculateLedgerPortfolioMetrics([{ netPnl: 10, returnPct: null }]);

    expect(result.profitFactor).toBeNull();
    expect(result.expectedValuePct).toBeNull();
    expect(result.sharpeRatio).toBeNull();
    expect(result.maxDrawdownPct).toBeNull();
  });
});

describe('resolveStrategyAllocationTarget', () => {
  it('uses a bounded canary adjustment before five verified attributed trades', () => {
    expect(resolveStrategyAllocationTarget({
      requestedWeight: 0.4,
      currentWeight: 0.18,
      verifiedAttributedTrades: 3,
    })).toEqual({
      mode: 'CANARY',
      targetWeight: 0.2,
      requestedWeight: 0.25,
    });
  });

  it('allows the full requested target after sufficient evidence', () => {
    expect(resolveStrategyAllocationTarget({
      requestedWeight: 0.23,
      currentWeight: 0.18,
      verifiedAttributedTrades: 5,
    })).toEqual({
      mode: 'FULL',
      targetWeight: 0.23,
      requestedWeight: 0.23,
    });
  });

  it('never exceeds the portfolio strategy exposure ceiling', () => {
    expect(resolveStrategyAllocationTarget({
      requestedWeight: 0.8,
      currentWeight: 0.24,
      verifiedAttributedTrades: 20,
      maxStrategyExposure: 0.25,
    }).targetWeight).toBe(0.25);
  });

  it('also bounds a canary allocation decrease', () => {
    expect(resolveStrategyAllocationTarget({
      requestedWeight: 0.05,
      currentWeight: 0.2,
      verifiedAttributedTrades: 0,
    }).targetWeight).toBe(0.18);
  });
});
