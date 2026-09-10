import { describe, expect, it } from 'vitest';
import {
  TradeThesisSchema,
  ThesisValidationResultSchema,
} from '../src/schemas/agents.js';

describe('TradeThesis schemas', () => {
  const validThesis = {
    thesisVersion: 1,
    decisionSource: 'AI' as const,
    state: 'PROBE_READY' as const,
    direction: 'LONG' as const,
    regime: 'PRE_BREAKOUT_ACCUMULATION',
    transitionProbability: 0.85,
    setup: 'RANGE_REVERSAL' as const,
    entryZone: { lower: 108_000, upper: 108_500 },
    trigger: [
      {
        type: 'PRICE_RECLAIM',
        price: 108_250,
        description: 'Reclaim of range low after sweep',
      },
    ],
    invalidation: {
      price: 107_500,
      reason: 'Loss of range low structural support',
    },
    stopLoss: 107_400,
    targets: [
      { price: 110_000, fraction: 0.5 },
      { price: 112_000, fraction: 0.5 },
    ],
    expectedNetR: 2.4,
    maximumChaseDistanceAtr: 0.6,
    confidence: 82,
    evidenceFor: [
      {
        snapshotField: 'structure',
        source: 'BINANCE_FUTURES',
        sourceTimestamp: '2026-09-09T11:59:00.000Z',
        calculationVersion: 1,
      },
    ],
    evidenceAgainst: [],
    missingEvidence: [],
    expiresAt: '2026-09-09T12:30:00.000Z',
  };

  it('validates a well-formed TradeThesis', () => {
    const result = TradeThesisSchema.safeParse(validThesis);
    expect(result.success).toBe(true);
  });

  it('allows WAIT thesis with null entryZone, invalidation, stopLoss, and expectedNetR', () => {
    const waitThesis = {
      ...validThesis,
      direction: 'WAIT' as const,
      setup: 'NO_TRADE' as const,
      state: 'WAIT' as const,
      entryZone: null,
      invalidation: null,
      stopLoss: null,
      expectedNetR: null,
      targets: [],
    };
    const result = TradeThesisSchema.safeParse(waitThesis);
    expect(result.success).toBe(true);
  });

  it('rejects unknown decisionSource', () => {
    const result = TradeThesisSchema.safeParse({
      ...validThesis,
      decisionSource: 'UNKNOWN_SOURCE',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid setup enum', () => {
    const result = TradeThesisSchema.safeParse({
      ...validThesis,
      setup: 'INVALID_SETUP',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown state', () => {
    const result = TradeThesisSchema.safeParse({
      ...validThesis,
      state: 'INVALID_STATE',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unrecognized extra fields because schema is strict', () => {
    const result = TradeThesisSchema.safeParse({
      ...validThesis,
      extraFieldNotAllowed: 'danger',
    });
    expect(result.success).toBe(false);
  });

  it('validates ThesisValidationResultSchema for both valid and invalid states', () => {
    const validResult = {
      valid: true,
      status: 'VALID' as const,
      reasonCodes: [],
      reasons: [],
    };
    expect(ThesisValidationResultSchema.safeParse(validResult).success).toBe(true);

    const invalidResult = {
      valid: false,
      status: 'INVALID' as const,
      reasonCodes: ['PROTECTION_REQUIRED' as const, 'GEOMETRY_INVALID' as const],
      reasons: ['Missing invalidation', 'Stop loss inverted'],
    };
    expect(ThesisValidationResultSchema.safeParse(invalidResult).success).toBe(true);

    const badCodeResult = {
      valid: false,
      status: 'INVALID' as const,
      reasonCodes: ['NOT_A_REAL_CODE'],
      reasons: ['Error'],
    };
    expect(ThesisValidationResultSchema.safeParse(badCodeResult).success).toBe(false);
  });
});
