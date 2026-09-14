import { describe, expect, it } from 'vitest';
import {
  evaluateRecoveryTransition,
  type RecoveryEvaluationInput,
  type RecoveryObservation,
  type RecoveryState,
} from '../../src/modules/pipeline/domain/recovery-reclaim';

describe('RecoveryReclaimStateMachine', () => {
  const baseInput: RecoveryEvaluationInput = {
    symbol: 'BTC-USDT',
    direction: 'LONG',
    timeframe: '15m',
    sourceDataCutoff: new Date('2026-09-14T12:00:00.000Z'),
    now: new Date('2026-09-14T12:05:00.000Z'),
    expiresAt: new Date('2026-09-14T16:00:00.000Z'),
    currentPrice: 101,
    atr: 2,
    persistedSupport: 100,
    persistedResistance: 120,
    emaReclaimLevel: 101.5,
    closedCandle: {
      open: 99,
      high: 102,
      low: 97, // swept support 100
      close: 101, // closed back inside range
      isClosed: true,
    },
    hasOppositeBreak: false,
    maxChaseAtr: 1.0,
    expectedNetR: 1.5,
    hasContradictoryEvent: false,
  };

  const initialObservation: RecoveryObservation = {
    state: 'RANGING',
    direction: 'LONG',
    lastObservedCutoff: null,
    invalidationPrice: 97,
    reclaimPrice: 101.5,
  };

  it('transitions RANGING -> LIQUIDITY_SWEEP on closed candle sweeping support and closing inside', () => {
    const result = evaluateRecoveryTransition(initialObservation, baseInput);

    expect(result.changed).toBe(true);
    expect(result.toState).toBe('LIQUIDITY_SWEEP');
    expect(result.reasonCode).toBe('LIQUIDITY_SWEEP_CONFIRMED');
    expect(result.evidence.sweptLevel).toBe(100);
  });

  it('transitions LIQUIDITY_SWEEP -> RECLAIM_PENDING when price is above support but below EMA reclaim', () => {
    const sweepObservation: RecoveryObservation = {
      ...initialObservation,
      state: 'LIQUIDITY_SWEEP',
      lastObservedCutoff: new Date('2026-09-14T12:00:00.000Z'),
    };

    const nextInput: RecoveryEvaluationInput = {
      ...baseInput,
      sourceDataCutoff: new Date('2026-09-14T12:15:00.000Z'),
      currentPrice: 101.2,
      closedCandle: {
        open: 101,
        high: 101.4,
        low: 100.5,
        close: 101.2,
        isClosed: true,
      },
    };

    const result = evaluateRecoveryTransition(sweepObservation, nextInput);

    expect(result.changed).toBe(true);
    expect(result.toState).toBe('RECLAIM_PENDING');
    expect(result.reasonCode).toBe('RECLAIM_LEVEL_APPROACHING');
  });

  it('transitions RECLAIM_PENDING -> MOMENTUM_CONFIRMED on closed candle closing beyond reclaim level with good R and within chase ATR', () => {
    const reclaimObservation: RecoveryObservation = {
      ...initialObservation,
      state: 'RECLAIM_PENDING',
      lastObservedCutoff: new Date('2026-09-14T12:15:00.000Z'),
    };

    const confirmedInput: RecoveryEvaluationInput = {
      ...baseInput,
      sourceDataCutoff: new Date('2026-09-14T12:30:00.000Z'),
      currentPrice: 102.0, // reclaim price is 101.5, distance is 0.5 ATR <= 1.0 ATR
      closedCandle: {
        open: 101.2,
        high: 102.5,
        low: 101.0,
        close: 102.0,
        isClosed: true,
      },
      expectedNetR: 1.8,
    };

    const result = evaluateRecoveryTransition(reclaimObservation, confirmedInput);

    expect(result.changed).toBe(true);
    expect(result.toState).toBe('MOMENTUM_CONFIRMED');
    expect(result.reasonCode).toBe('RECLAIM_MOMENTUM_CONFIRMED');
  });

  it('rejects MOMENTUM_CONFIRMED if candle is unfinished / not closed', () => {
    const reclaimObservation: RecoveryObservation = {
      ...initialObservation,
      state: 'RECLAIM_PENDING',
      lastObservedCutoff: new Date('2026-09-14T12:15:00.000Z'),
    };

    const unclosedInput: RecoveryEvaluationInput = {
      ...baseInput,
      sourceDataCutoff: new Date('2026-09-14T12:30:00.000Z'),
      currentPrice: 102.0,
      closedCandle: {
        open: 101.2,
        high: 102.5,
        low: 101.0,
        close: 102.0,
        isClosed: false, // NOT closed!
      },
    };

    const result = evaluateRecoveryTransition(reclaimObservation, unclosedInput);

    expect(result.toState).not.toBe('MOMENTUM_CONFIRMED');
    expect(result.toState).toBe('RECLAIM_PENDING');
    expect(result.reasonCode).toBe('CANDLE_UNFINISHED');
  });

  it('rejects confirmation and transitions to TOO_LATE if price exceeded max chase ATR', () => {
    const reclaimObservation: RecoveryObservation = {
      ...initialObservation,
      state: 'RECLAIM_PENDING',
      lastObservedCutoff: new Date('2026-09-14T12:15:00.000Z'),
    };

    const chaseInput: RecoveryEvaluationInput = {
      ...baseInput,
      sourceDataCutoff: new Date('2026-09-14T12:30:00.000Z'),
      currentPrice: 105.0, // Reclaim 101.5, diff 3.5 > maxChase 2.0 (1.0 * ATR 2)
      closedCandle: {
        open: 101.2,
        high: 105.0,
        low: 101.0,
        close: 105.0,
        isClosed: true,
      },
    };

    const result = evaluateRecoveryTransition(reclaimObservation, chaseInput);

    expect(result.toState).toBe('TOO_LATE');
    expect(result.reasonCode).toBe('PRICE_BEYOND_CHASE_LIMIT');
  });

  it('invalidates on opposite structural break', () => {
    const sweepObservation: RecoveryObservation = {
      ...initialObservation,
      state: 'LIQUIDITY_SWEEP',
      lastObservedCutoff: new Date('2026-09-14T12:00:00.000Z'),
    };

    const brokenInput: RecoveryEvaluationInput = {
      ...baseInput,
      sourceDataCutoff: new Date('2026-09-14T12:15:00.000Z'),
      hasOppositeBreak: true,
      currentPrice: 96,
    };

    const result = evaluateRecoveryTransition(sweepObservation, brokenInput);

    expect(result.toState).toBe('INVALIDATED');
    expect(result.reasonCode).toBe('OPPOSITE_STRUCTURAL_BREAK');
  });

  it('rejects duplicate or older candle cutoff', () => {
    const sweepObservation: RecoveryObservation = {
      ...initialObservation,
      state: 'LIQUIDITY_SWEEP',
      lastObservedCutoff: new Date('2026-09-14T12:00:00.000Z'),
    };

    const dupInput: RecoveryEvaluationInput = {
      ...baseInput,
      sourceDataCutoff: new Date('2026-09-14T12:00:00.000Z'),
    };

    const result = evaluateRecoveryTransition(sweepObservation, dupInput);

    expect(result.changed).toBe(false);
    expect(result.reasonCode).toBe('DUPLICATE_CANDLE_CUTOFF');
  });

  it('advances at most one executable state per candle', () => {
    const input: RecoveryEvaluationInput = {
      ...baseInput,
      currentPrice: 103,
      closedCandle: {
        open: 96,
        high: 103,
        low: 95,
        close: 103,
        isClosed: true,
      },
    };

    const result = evaluateRecoveryTransition(initialObservation, input);

    expect(result.toState).toBe('LIQUIDITY_SWEEP');
  });

  it('handles SHORT recovery sweeps (sweeps resistance high and closes back inside)', () => {
    const shortInitial: RecoveryObservation = {
      state: 'RANGING',
      direction: 'SHORT',
      lastObservedCutoff: null,
      invalidationPrice: 125,
      reclaimPrice: 118.5,
    };

    const shortInput: RecoveryEvaluationInput = {
      ...baseInput,
      direction: 'SHORT',
      persistedSupport: 100,
      persistedResistance: 120,
      emaReclaimLevel: 118.5,
      currentPrice: 119,
      closedCandle: {
        open: 119,
        high: 123,
        low: 118,
        close: 119,
        isClosed: true,
      },
    };

    const result = evaluateRecoveryTransition(shortInitial, shortInput);

    expect(result.changed).toBe(true);
    expect(result.toState).toBe('LIQUIDITY_SWEEP');
    expect(result.reasonCode).toBe('LIQUIDITY_SWEEP_CONFIRMED');
    expect(result.evidence.sweptLevel).toBe(120);
  });
});
