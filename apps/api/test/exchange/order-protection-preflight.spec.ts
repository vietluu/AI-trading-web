import { describe, expect, it } from 'vitest';
import { preflightOrderProtection } from '../../src/exchange/domain/order-protection-preflight';

describe('order-protection-preflight', () => {
  it('rejects a long locally when the fresh market has already crossed its stop', () => {
    expect(preflightOrderProtection({ side: 'BUY', entry: 0.9847369, stopLoss: 0.96017669,
      takeProfit: 1.03945441, currentPrice: 0.9515, tickSize: 0.0001 })).toEqual({
        approved: false, reason: 'STOP_ALREADY_BREACHED',
      });
  });

  it('normalizes valid short protection without changing its ordering', () => {
    expect(preflightOrderProtection({ side: 'SELL', entry: 0.9665911, stopLoss: 0.9934153,
      takeProfit: 0.91932612, currentPrice: 0.9637, tickSize: 0.0001 })).toMatchObject({
        approved: true, entry: 0.9666, stopLoss: 0.9934, takeProfit: 0.9193,
      });
  });

  it('rejects when protection geometry is inverted', () => {
    expect(preflightOrderProtection({ side: 'BUY', entry: 100, stopLoss: 105, takeProfit: 110, currentPrice: 102 })).toEqual({
      approved: false, reason: 'ENTRY_PROTECTION_GEOMETRY_INVALID',
    });
    expect(preflightOrderProtection({ side: 'SELL', entry: 100, stopLoss: 95, takeProfit: 90, currentPrice: 98 })).toEqual({
      approved: false, reason: 'ENTRY_PROTECTION_GEOMETRY_INVALID',
    });
  });

  it('rejects when take profit has already been crossed', () => {
    expect(preflightOrderProtection({ side: 'BUY', entry: 100, stopLoss: 95, takeProfit: 110, currentPrice: 111 })).toEqual({
      approved: false, reason: 'TAKE_PROFIT_ALREADY_CROSSED',
    });
    expect(preflightOrderProtection({ side: 'SELL', entry: 100, stopLoss: 105, takeProfit: 90, currentPrice: 89 })).toEqual({
      approved: false, reason: 'TAKE_PROFIT_ALREADY_CROSSED',
    });
  });

  it('rejects when a marketable limit exceeds slippage allowance', () => {
    expect(preflightOrderProtection({ side: 'BUY', entry: 101.5, stopLoss: 95, takeProfit: 110, currentPrice: 100, maxSlippagePct: 0.01, timeInForce: 'IOC' })).toEqual({
      approved: false, reason: 'MARKETABLE_LIMIT_SLIPPAGE_EXCEEDED',
    });
    expect(preflightOrderProtection({ side: 'SELL', entry: 98.5, stopLoss: 105, takeProfit: 90, currentPrice: 100, maxSlippagePct: 0.01, timeInForce: 'IOC' })).toEqual({
      approved: false, reason: 'MARKETABLE_LIMIT_SLIPPAGE_EXCEEDED',
    });
  });

  it('rejects when tick rounding collapses entry and stop loss into invalid geometry', () => {
    expect(preflightOrderProtection({
      side: 'BUY',
      entry: 100.04,
      stopLoss: 100.01,
      takeProfit: 110,
      currentPrice: 100.04,
      tickSize: 0.1,
    })).toEqual({
      approved: false,
      reason: 'ENTRY_PROTECTION_GEOMETRY_INVALID',
    });
    expect(preflightOrderProtection({
      side: 'SELL',
      entry: 100.01,
      stopLoss: 100.04,
      takeProfit: 90,
      currentPrice: 100.01,
      tickSize: 0.1,
    })).toEqual({
      approved: false,
      reason: 'ENTRY_PROTECTION_GEOMETRY_INVALID',
    });
  });
});
