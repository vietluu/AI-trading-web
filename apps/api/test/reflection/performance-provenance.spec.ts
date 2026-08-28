import { describe, expect, it } from "vitest";
import { performanceDriftToleranceMs } from "../../src/modules/reflection/domain/performance-provenance";

describe("performanceDriftToleranceMs", () => {
  it("returns 60_000 for M15", () => {
    expect(performanceDriftToleranceMs("M15", 15 * 60_000)).toBe(60_000);
  });

  it("returns 60_000 for M30", () => {
    expect(performanceDriftToleranceMs("M30", 30 * 60_000)).toBe(60_000);
  });

  it("returns 120_000 for MID", () => {
    expect(performanceDriftToleranceMs("MID", 60 * 60_000)).toBe(120_000);
  });

  it("returns 120_000 for H2", () => {
    expect(performanceDriftToleranceMs("H2", 2 * 60 * 60_000)).toBe(120_000);
  });

  it("returns 120_000 for H4", () => {
    expect(performanceDriftToleranceMs("H4", 4 * 60 * 60_000)).toBe(120_000);
  });

  it("returns 300_000 for LONG", () => {
    expect(performanceDriftToleranceMs("LONG", 24 * 60 * 60_000)).toBe(300_000);
  });

  it("clamps SHORT tolerance to at least 15_000", () => {
    expect(performanceDriftToleranceMs("SHORT", 100_000)).toBe(15_000);
  });

  it("clamps SHORT tolerance to at most 60_000", () => {
    expect(performanceDriftToleranceMs("SHORT", 900_000)).toBe(60_000);
  });

  it("computes SHORT tolerance as 10% of configured duration within clamp", () => {
    expect(performanceDriftToleranceMs("SHORT", 300_000)).toBe(30_000);
  });
});
