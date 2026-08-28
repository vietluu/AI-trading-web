import { describe, expect, it, vi } from "vitest";
import { executeWithSingleDriftReassessment } from "../../src/modules/pipeline/application/entry-drift-reassessment";

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
