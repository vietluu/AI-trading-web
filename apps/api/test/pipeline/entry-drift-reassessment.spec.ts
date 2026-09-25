import { describe, expect, it, vi } from "vitest";
import { executeWithSingleDriftReassessment } from "../../src/modules/pipeline/application/entry-drift-reassessment";
import { evaluatePersistedThesisEntry } from "../../src/modules/risk/domain/thesis-execution";
import { transitionPersistedThesisEntry } from "../../src/modules/pipeline/domain/opportunity-state-machine";
import { createBaseSnapshot, createValidLongThesis } from "../helpers/thesis-fixture";

function persistedThesisEntry(price: number, overrides: {
  now?: Date;
  thesis?: ReturnType<typeof createValidLongThesis>;
  atr?: number;
} = {}) {
  const snapshot = createBaseSnapshot();
  if (snapshot.execution.coverage !== 'AVAILABLE') throw new Error('fixture execution must be available');
  snapshot.execution = { ...snapshot.execution, currentPrice: price };
  return evaluatePersistedThesisEntry({
    thesis: overrides.thesis ?? createValidLongThesis(),
    snapshot,
    currentPrice: price,
    atr: overrides.atr ?? 200,
    now: overrides.now ?? new Date('2026-09-09T12:00:00.000Z'),
  });
}

describe('evaluatePersistedThesisEntry', () => {
  it('enters only when the live price is inside the persisted zone and trigger is satisfied', () => {
    expect(persistedThesisEntry(108_300)).toMatchObject({
      action: 'ENTER',
      reasonCode: 'ENTRY_ZONE_AND_TRIGGER_SATISFIED',
    });
  });

  it('waits for the persisted trigger when price is inside the zone before a reclaim', () => {
    expect(persistedThesisEntry(108_200)).toMatchObject({
      action: 'WAIT_PULLBACK',
      reasonCode: 'TRIGGER_NOT_SATISFIED',
    });
  });

  it('rejects a long chase beyond the persisted ATR distance', () => {
    expect(persistedThesisEntry(108_621)).toMatchObject({
      action: 'TOO_LATE',
      reasonCode: 'CHASE_DISTANCE_EXCEEDED',
    });
  });

  it('expires before considering live entry geometry', () => {
    expect(persistedThesisEntry(108_300, {
      now: new Date('2026-09-09T12:30:00.000Z'),
    })).toMatchObject({
      action: 'EXPIRED',
      reasonCode: 'THESIS_EXPIRED',
    });
  });

  it('invalidates before considering a reclaim trigger', () => {
    expect(persistedThesisEntry(107_500)).toMatchObject({
      action: 'INVALIDATED',
      reasonCode: 'THESIS_INVALIDATED',
    });
  });

  it('waits when the latest snapshot has no usable ATR', () => {
    expect(persistedThesisEntry(108_300, { atr: Number.NaN })).toMatchObject({
      action: 'WAIT_PULLBACK',
      reasonCode: 'VOLATILITY_UNAVAILABLE',
    });
  });

  it('maps a terminal persisted-thesis decision to the opportunity terminal state', () => {
    expect(transitionPersistedThesisEntry({
      state: 'PROBE_READY',
      setup: 'TREND_PULLBACK',
      direction: 'LONG',
      invalidationPrice: 107_500,
      expiresAt: new Date('2026-09-09T12:30:00.000Z'),
      lastObservedCutoff: null,
    }, new Date('2026-09-09T12:00:00.000Z'), {
      action: 'TOO_LATE',
      reasonCode: 'CHASE_DISTANCE_EXCEEDED',
    })).toMatchObject({
      toState: 'TOO_LATE',
      entryReasonCode: 'CHASE_DISTANCE_EXCEEDED',
    });
  });
});

describe("executeWithSingleDriftReassessment", () => {
  it("returns success on first attempt without reassessing", async () => {
    const assess = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue({ outcome: "ORDER_SUBMITTED" });

    const result = await executeWithSingleDriftReassessment({ assess, execute });

    expect(result).toEqual({ outcome: "ORDER_SUBMITTED" });
    expect(assess).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("reassesses once and retries when first execution drifts", async () => {
    const assess = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn()
      .mockResolvedValueOnce({ outcome: "EXECUTION_FAILED", errorCode: "ENTRY_PRICE_DRIFT" })
      .mockResolvedValueOnce({ outcome: "ORDER_SUBMITTED" });

    const result = await executeWithSingleDriftReassessment({ assess, execute });

    expect(result).toEqual({ outcome: "ORDER_SUBMITTED" });
    expect(assess).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("stops after second attempt even if it drifts again", async () => {
    const assess = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue(
      { outcome: "EXECUTION_FAILED", errorCode: "ENTRY_PRICE_DRIFT" },
    );

    const result = await executeWithSingleDriftReassessment({ assess, execute });

    expect(assess).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.outcome).toBe("EXECUTION_FAILED");
    expect(result.errorCode).toBe("ENTRY_PRICE_DRIFT");
  });

  it("does not reassess on non-drift execution failure", async () => {
    const assess = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue(
      { outcome: "EXECUTION_FAILED", errorCode: "INSUFFICIENT_MARGIN" },
    );

    const result = await executeWithSingleDriftReassessment({ assess, execute });

    expect(assess).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("EXECUTION_FAILED");
  });

  it("returns risk rejection from reassessment without executing a second time", async () => {
    const assess = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const execute = vi.fn()
      .mockResolvedValueOnce({ outcome: "EXECUTION_FAILED", errorCode: "ENTRY_PRICE_DRIFT" })
      .mockResolvedValueOnce({ outcome: "RISK_REJECTED", reason: "INSUFFICIENT_AVAILABLE_MARGIN" });

    const result = await executeWithSingleDriftReassessment({ assess, execute });

    expect(assess).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.outcome).toBe("RISK_REJECTED");
  });
});
