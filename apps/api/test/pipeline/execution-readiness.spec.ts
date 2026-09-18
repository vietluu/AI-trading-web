import { describe, expect, it } from 'vitest';
import type { DecisionOutput } from '@platform/shared';

import { buildExecutionContext } from '../../src/modules/pipeline/domain/execution-context';
import { evaluateExecutionReadiness } from '../../src/modules/pipeline/domain/execution-readiness';

const sourceDataCutoff = new Date('2026-09-16T00:00:00.000Z');

function decisionFixture(input: {
  action: 'WAIT' | 'ENTER';
  triggerConfirmed: boolean;
  closed: boolean;
}): DecisionOutput {
  return {
    decision: 'SHORT',
    executionContext: buildExecutionContext({
      regime: 'RANGING',
      setup: 'RANGE_REVERSION',
      action: input.action,
      price: 109,
      support: 100,
      resistance: 110,
      atr: 2,
      sourceDataCutoff,
      primaryCandleClosed: input.closed,
      triggerConfirmed: input.triggerConfirmed,
    }),
  } as DecisionOutput;
}

function validRangeShortFixture(): DecisionOutput {
  return decisionFixture({
    action: 'ENTER',
    triggerConfirmed: true,
    closed: true,
  });
}

describe('execution readiness', () => {
  it.each([
    ['WAIT', true, true, 'ENTRY_ACTION_NOT_EXECUTABLE'],
    ['ENTER', false, true, 'ENTRY_TRIGGER_NOT_CONFIRMED'],
    ['ENTER', true, false, 'PRIMARY_CANDLE_NOT_CLOSED'],
  ] as const)('blocks contradictory execution context', (action, triggerConfirmed, closed, reason) => {
    const result = evaluateExecutionReadiness(decisionFixture({ action, triggerConfirmed, closed }));

    expect(result).toEqual({ allowed: false, reasonCodes: [reason] });
  });

  it('allows a directional decision only when its deterministic context is executable', () => {
    expect(evaluateExecutionReadiness(validRangeShortFixture())).toEqual({ allowed: true, reasonCodes: [] });
  });

  it('preserves candidate direction SHORT/85 when execution context action is WAIT while blocking execution readiness', () => {
    const candidate = {
      decision: 'SHORT',
      confidence: 85,
      executionContext: buildExecutionContext({
        regime: 'RANGING',
        setup: 'RANGE_REVERSION',
        action: 'WAIT',
        price: 100,
        support: 95,
        resistance: 105,
        atr: 1.5,
        sourceDataCutoff,
        primaryCandleClosed: true,
        triggerConfirmed: false,
      }),
    } as unknown as DecisionOutput;

    const readiness = evaluateExecutionReadiness(candidate);
    expect(readiness.allowed).toBe(false);
    expect(readiness.reasonCodes).toContain('ENTRY_ACTION_NOT_EXECUTABLE');
    expect(candidate.decision).toBe('SHORT');
    expect(candidate.confidence).toBe(85);
  });
});

