import { describe, expect, it } from "vitest";
import { evaluateCollateralHealth } from "../../src/modules/risk/domain/collateral-health";

describe("evaluateCollateralHealth", () => {
  it("warns when available collateral is below ten percent of equity", () => {
    expect(evaluateCollateralHealth(100_000, 4_000, 0.1)).toEqual({
      healthy: false,
      ratio: 0.04,
      reason: "AVAILABLE_COLLATERAL_BELOW_WARNING_RATIO",
    });
  });

  it("does not warn for zero equity or a ratio at the boundary", () => {
    expect(evaluateCollateralHealth(0, 0, 0.1).healthy).toBe(true);
    expect(evaluateCollateralHealth(100_000, 10_000, 0.1).healthy).toBe(true);
  });
});
