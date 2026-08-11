import { describe, expect, it } from "vitest";
import { formatNumber } from "../src/lib/utils";

describe("formatNumber", () => {
  it("renders exactly two fractional digits by default", () => {
    expect(formatNumber(53.333333333333336)).toBe("53.33");
    expect(formatNumber(45.498931949954226)).toBe("45.50");
    expect(formatNumber(100)).toBe("100.00");
  });

  it("uses a safe fallback for missing or invalid values", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(Number.NaN)).toBe("—");
  });
});
