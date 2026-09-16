import { describe, expect, it } from 'vitest';
import { selectEntryOrderPolicy } from '../../src/modules/risk/domain/entry-order-policy';

describe('entry-order-policy', () => {
  it.each([
    ['RANGE_REVERSION', 'mean-reversion', 'GTC', 2],
    ['TREND_PULLBACK', 'trend', 'GTC', 2],
    ['BREAKOUT_RETEST', 'breakout', 'IOC', 1],
    ['TREND_PULLBACK', 'momentum-scalp', 'IOC', 1],
  ] as const)('selects bounded entry policy for %s/%s', (setup, strategyKey, tif, ttl) => {
    const result = selectEntryOrderPolicy({ setup, strategyKey, side: 'SELL', bid: 96.72, ask: 96.73, tickSize: 0.01, maxSlippagePct: 0.001 });
    expect(result).toMatchObject({ orderType: 'LIMIT', timeInForce: tif, expiryCandles: ttl });
  });

  it('normalizes IOC limit price with slippage cap for BUY and SELL', () => {
    const buyResult = selectEntryOrderPolicy({
      setup: 'BREAKOUT_RETEST',
      strategyKey: 'breakout',
      side: 'BUY',
      bid: 96.72,
      ask: 96.73,
      tickSize: 0.01,
      maxSlippagePct: 0.001,
    });
    expect(buyResult.orderType).toBe('LIMIT');
    expect(buyResult.timeInForce).toBe('IOC');
    expect(buyResult.limitPrice).toBe(96.83);

    const sellResult = selectEntryOrderPolicy({
      setup: 'BREAKOUT_RETEST',
      strategyKey: 'breakout',
      side: 'SELL',
      bid: 96.72,
      ask: 96.73,
      tickSize: 0.01,
      maxSlippagePct: 0.001,
    });
    expect(sellResult.timeInForce).toBe('IOC');
    expect(sellResult.limitPrice).toBe(96.62);
  });

  it('preserves structural price for GTC orders', () => {
    const gtcResult = selectEntryOrderPolicy({
      setup: 'RANGE_REVERSION',
      strategyKey: 'mean-reversion',
      side: 'SELL',
      bid: 96.72,
      ask: 96.73,
      structuralPrice: 97.50,
      tickSize: 0.01,
    });
    expect(gtcResult.orderType).toBe('LIMIT');
    expect(gtcResult.timeInForce).toBe('GTC');
    expect(gtcResult.expiryCandles).toBe(2);
    expect(gtcResult.limitPrice).toBe(97.50);
  });
});
