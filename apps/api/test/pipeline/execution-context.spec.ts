import { describe, expect, it } from 'vitest';

import {
  buildExecutionContext,
  validateSetupLocation,
} from '../../src/modules/pipeline/domain/execution-context';

const sourceDataCutoff = new Date('2026-09-12T22:59:59.999Z');

describe('execution context', () => {
  it('rejects the ZRO normal short near range support', () => {
    const context = buildExecutionContext({
      regime: 'RANGING',
      setup: 'RANGE_REVERSION',
      action: 'ENTER',
      price: 1.0171,
      support: 1.0151,
      resistance: 1.0245,
      atr: 0.00467606,
      sourceDataCutoff,
      primaryCandleClosed: true,
      triggerConfirmed: true,
    });

    expect(context.priceLocation.rangePercentile).toBeCloseTo(0.2128, 3);
    expect(validateSetupLocation(context, 'SHORT'))
      .toContain('RANGE_SHORT_NOT_AT_UPPER_BOUNDARY');
  });

  it('permits a short at the upper range boundary', () => {
    const context = buildExecutionContext({
      regime: 'RANGING',
      setup: 'RANGE_REVERSION',
      action: 'ENTER',
      price: 1.0235,
      support: 1.0151,
      resistance: 1.0245,
      atr: 0.00467606,
      sourceDataCutoff,
      primaryCandleClosed: true,
      triggerConfirmed: true,
    });

    expect(validateSetupLocation(context, 'SHORT')).toEqual([]);
  });

  it('makes an intrabar transition probe-only', () => {
    const context = buildExecutionContext({
      regime: 'PRE_BREAKOUT',
      setup: 'TRANSITION_PROBE',
      action: 'PROBE',
      price: 100.4,
      support: 98,
      resistance: 100,
      triggerPrice: 100,
      atr: 1,
      sourceDataCutoff: new Date('2026-09-13T00:01:00Z'),
      primaryCandleClosed: false,
    });

    expect(context.riskTier).toBe('PROBE');
    expect(context.usesClosedPrimaryCandle).toBe(false);
  });

  it('clamps a price outside the range to its nearest percentile boundary', () => {
    const context = buildExecutionContext({
      regime: 'RANGING',
      setup: 'RANGE_REVERSION',
      action: 'WAIT',
      price: 95,
      support: 100,
      resistance: 110,
      atr: 2,
      sourceDataCutoff,
      primaryCandleClosed: true,
    });

    expect(context.priceLocation.rangePercentile).toBe(0);
  });

  it('rejects a range long away from the lower boundary', () => {
    const context = buildExecutionContext({
      regime: 'RANGING',
      setup: 'RANGE_REVERSION',
      action: 'ENTER',
      price: 104,
      support: 100,
      resistance: 110,
      atr: 2,
      sourceDataCutoff,
      primaryCandleClosed: true,
      triggerConfirmed: true,
    });

    expect(validateSetupLocation(context, 'LONG'))
      .toContain('RANGE_LONG_NOT_AT_LOWER_BOUNDARY');
  });

  it('rejects a normal entry from an open primary candle', () => {
    const context = buildExecutionContext({
      regime: 'TRENDING',
      setup: 'TREND_PULLBACK',
      action: 'ENTER',
      price: 100,
      atr: 2,
      sourceDataCutoff,
      primaryCandleClosed: false,
      triggerConfirmed: true,
    });

    expect(validateSetupLocation(context, 'LONG'))
      .toContain('PRIMARY_CANDLE_NOT_CLOSED');
  });

  it('rejects an entry whose structural trigger is unconfirmed', () => {
    const context = buildExecutionContext({
      regime: 'TRENDING',
      setup: 'TREND_PULLBACK',
      action: 'ENTER',
      price: 100,
      atr: 2,
      sourceDataCutoff,
      primaryCandleClosed: true,
      triggerConfirmed: false,
    });

    expect(validateSetupLocation(context, 'LONG'))
      .toContain('ENTRY_TRIGGER_NOT_CONFIRMED');
  });

  it('rejects an executable probe whose structural trigger is unconfirmed', () => {
    const context = buildExecutionContext({
      regime: 'PRE_BREAKOUT',
      setup: 'TRANSITION_PROBE',
      action: 'PROBE',
      price: 100,
      atr: 2,
      sourceDataCutoff,
      primaryCandleClosed: false,
      triggerConfirmed: false,
    });

    expect(validateSetupLocation(context, 'LONG'))
      .toContain('ENTRY_TRIGGER_NOT_CONFIRMED');
  });

  it('rejects an executable range setup without a proven location', () => {
    const context = buildExecutionContext({
      regime: 'RANGING',
      setup: 'RANGE_REVERSION',
      action: 'ENTER',
      price: 100,
      atr: 2,
      sourceDataCutoff,
      primaryCandleClosed: true,
      triggerConfirmed: true,
    });

    expect(validateSetupLocation(context, 'LONG'))
      .toContain('RANGE_LOCATION_UNAVAILABLE');
  });

  it('rejects non-finite price input before it can enter the context', () => {
    expect(() => buildExecutionContext({
      regime: 'RANGING',
      setup: 'RANGE_REVERSION',
      action: 'WAIT',
      price: Number.NaN,
      support: 100,
      resistance: 110,
      atr: 2,
      sourceDataCutoff,
      primaryCandleClosed: true,
    })).toThrow('price must be a finite number');
  });

  it('rejects non-finite optional input before it can enter the context', () => {
    expect(() => buildExecutionContext({
      regime: 'BREAKOUT',
      setup: 'BREAKOUT_RETEST',
      action: 'ENTER',
      price: 100,
      triggerPrice: Number.POSITIVE_INFINITY,
      atr: 2,
      sourceDataCutoff,
      primaryCandleClosed: true,
      triggerConfirmed: true,
    })).toThrow('triggerPrice must be a finite number');
  });

  it('rejects an entry beyond the configured trigger chase distance', () => {
    const context = buildExecutionContext({
      regime: 'BREAKOUT',
      setup: 'BREAKOUT_RETEST',
      action: 'ENTER',
      price: 102,
      triggerPrice: 100,
      atr: 1,
      sourceDataCutoff,
      primaryCandleClosed: true,
      triggerConfirmed: true,
    });

    expect(validateSetupLocation(context, 'LONG'))
      .toContain('ENTRY_CHASE_DISTANCE_EXCEEDED');
  });

  it('rejects an entry after more than half of the expected move is consumed', () => {
    const context = buildExecutionContext({
      regime: 'TRENDING',
      setup: 'TREND_PULLBACK',
      action: 'ENTER',
      price: 100,
      atr: 2,
      moveConsumedPct: 0.51,
      sourceDataCutoff,
      primaryCandleClosed: true,
      triggerConfirmed: true,
    });

    expect(validateSetupLocation(context, 'LONG'))
      .toContain('EXPECTED_MOVE_ALREADY_CONSUMED');
  });
});
