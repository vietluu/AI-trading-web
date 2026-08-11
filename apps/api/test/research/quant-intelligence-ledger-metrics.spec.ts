import { describe, expect, it } from 'vitest';
import { calculateLedgerPortfolioMetrics } from '../../src/modules/research/application/quant-intelligence.service';

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
