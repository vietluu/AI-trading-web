import { describe, expect, it } from 'vitest';
import { calculateFee, calculatePnL, deterministicSlippage, executionPrice, maximumDrawdown, protectiveExit } from '../../src/modules/paper-trading/domain/paper-trading';

describe('paper trading calculations', () => {
  it('calculates long and short PnL', () => {
    expect(calculatePnL('LONG', 100, 110, 2)).toBe(20);
    expect(calculatePnL('SHORT', 100, 90, 2)).toBe(20);
    expect(calculatePnL('SHORT', 100, 110, 2)).toBe(-20);
  });
  it('calculates taker fees from executed notional', () => {
    expect(calculateFee(50_000, 0.01, 0.0004)).toBeCloseTo(0.2);
  });
  it('produces bounded deterministic adverse slippage', () => {
    const value = deterministicSlippage('run-1:OPEN:BUY', 0.0002, 0.001);
    expect(value).toBeGreaterThanOrEqual(0.0002);
    expect(value).toBeLessThanOrEqual(0.001);
    expect(deterministicSlippage('run-1:OPEN:BUY', 0.0002, 0.001)).toBe(value);
    expect(executionPrice(100, 'BUY', value)).toBeGreaterThan(100);
    expect(executionPrice(100, 'SELL', value)).toBeLessThan(100);
  });
  it('prioritizes liquidation and evaluates protective exits by side', () => {
    expect(protectiveExit('LONG', 100, 80, -20, 30, 0.02, 0.04)).toBe('LIQUIDATION');
    expect(protectiveExit('LONG', 100, 97, -3, 100, 0.02, 0.04)).toBe('STOP_LOSS');
    expect(protectiveExit('SHORT', 100, 95, 5, 100, 0.02, 0.04)).toBe('TAKE_PROFIT');
  });
  it('tracks maximum historical drawdown even after recovery', () => {
    expect(maximumDrawdown([10_000, 12_000, 9_000, 13_000])).toBe(25);
  });
});
