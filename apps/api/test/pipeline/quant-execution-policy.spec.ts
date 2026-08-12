import { describe, expect, it, vi } from "vitest";
import { QuantExecutionPolicyService } from "../../src/modules/pipeline/application/quant-execution-policy.service";

const decision = (side: "LONG" | "SHORT" = "LONG", regime = "TRENDING") => ({ decision: side, regime: { type: regime } });

function service(validation: Record<string, unknown> | null, regime: Record<string, unknown> | null = null) {
  return new QuantExecutionPolicyService({
    researchValidationRun: { findFirst: vi.fn().mockResolvedValue(validation) },
    marketRegimeState: { findFirst: vi.fn().mockResolvedValue(regime) },
  } as never);
}

const valid = (overrides: Record<string, unknown> = {}) => ({
  probabilityOfProfit: 62, probabilityOfRuin: 1, outOfSampleSharpe: 1.2,
  walkForwardStable: true, confidenceBrierScore: 0.18,
  createdAt: new Date("2026-08-12T00:00:00Z"), ...overrides,
});

describe("QuantExecutionPolicyService", () => {
  const input = {
    userId: "user-1", symbol: "ETH-USDT", provider: "OKX_FUTURES", timeframe: "15m",
    decision: decision() as never, now: new Date("2026-08-12T01:00:00Z"),
  };

  it("fails closed when exact symbol/provider/timeframe validation is missing", async () => {
    await expect(service(null).evaluate(input)).resolves.toMatchObject({ allowed: false, reason: "QUANT_VALIDATION_MISSING" });
  });

  it("blocks the observed ETH-quality evidence when walk-forward is unstable", async () => {
    const result = await service(valid({ probabilityOfProfit: 30.94, probabilityOfRuin: 100, walkForwardStable: false })).evaluate(input);
    expect(result).toMatchObject({ allowed: false, reason: "QUANT_WALK_FORWARD_UNSTABLE" });
  });

  it("allows validated out-of-sample edge that agrees with fresh quant regime", async () => {
    const result = await service(valid(), { regime: "BULL", confidence: 82, detectedAt: new Date("2026-08-12T00:55:00Z") }).evaluate(input);
    expect(result.allowed).toBe(true);
    expect(result.validation?.outOfSampleSharpe).toBe(1.2);
  });

  it("blocks a directional trade against a fresh high-confidence quant regime", async () => {
    const result = await service(valid(), { regime: "BEAR", confidence: 82, detectedAt: new Date("2026-08-12T00:55:00Z") }).evaluate(input);
    expect(result).toMatchObject({ allowed: false, reason: "QUANT_REGIME_CONFLICT" });
  });
});
