import { describe, expect, it, vi } from "vitest";
import { QuantExecutionPolicyService } from "../../src/modules/pipeline/application/quant-execution-policy.service";

const decision = (side: "LONG" | "SHORT" = "LONG", regime = "TRENDING") => ({ decision: side, regime: { type: regime } });

function service(validation: Record<string, unknown> | null, regime: Record<string, unknown> | null = null) {
  const findFirst = vi.fn().mockResolvedValue(validation);
  return { policy: new QuantExecutionPolicyService({
    researchValidationRun: { findFirst },
    marketRegimeState: { findFirst: vi.fn().mockResolvedValue(regime) },
  } as never), findFirst };
}

function serviceWithLimits(validation: Record<string, unknown>, limits: Record<string, number>) {
  return new QuantExecutionPolicyService({
    researchValidationRun: { findFirst: vi.fn().mockResolvedValue(validation) },
    marketRegimeState: { findFirst: vi.fn().mockResolvedValue(null) },
  } as never, { getUserLimits: vi.fn().mockResolvedValue(limits) } as never);
}

const valid = (overrides: Record<string, unknown> = {}) => ({
  probabilityOfProfit: 62, probabilityOfRuin: 1, outOfSampleSharpe: 1.2,
  walkForwardStable: true, confidenceBrierScore: 0.18,
  metricsJson: {
    sampleEvidence: { totalTrades: 50, outOfSampleTrades: 12, walkForwardWindows: 5 },
    outOfSample: { outOfSampleTrades: 12 },
    walkForward: { windows: Array.from({ length: 5 }, () => ({})) },
    executionAssumptions: { leverage: 1, riskPerTrade: 0.02, riskRewardRatio: 1.5 },
    calibration: { evidenceSufficient: false },
  },
  createdAt: new Date("2026-08-12T00:00:00Z"), ...overrides,
});

describe("QuantExecutionPolicyService", () => {
  const input = {
    userId: "user-1", symbol: "ETH-USDT", provider: "OKX_FUTURES", timeframe: "15m",
    decision: decision() as never, now: new Date("2026-08-12T01:00:00Z"),
  };

  it("fails closed when exact symbol/provider/timeframe validation is missing", async () => {
    await expect(service(null).policy.evaluate(input)).resolves.toMatchObject({ allowed: false, reason: "QUANT_VALIDATION_MISSING" });
  });

  it("blocks the observed ETH-quality evidence when walk-forward is unstable", async () => {
    const result = await service(valid({ probabilityOfProfit: 30.94, probabilityOfRuin: 100, walkForwardStable: false })).policy.evaluate(input);
    expect(result).toMatchObject({ allowed: false, reason: "QUANT_WALK_FORWARD_UNSTABLE" });
  });

  it("allows validated out-of-sample edge that agrees with fresh quant regime", async () => {
    const result = await service(valid(), { regime: "BULL", confidence: 82, detectedAt: new Date("2026-08-12T00:55:00Z") }).policy.evaluate(input);
    expect(result.allowed).toBe(true);
    expect(result.validation?.outOfSampleSharpe).toBe(1.2);
  });

  it("blocks a directional trade against a fresh high-confidence quant regime", async () => {
    const result = await service(valid(), { regime: "BEAR", confidence: 82, detectedAt: new Date("2026-08-12T00:55:00Z") }).policy.evaluate(input);
    expect(result).toMatchObject({ allowed: false, reason: "QUANT_REGIME_CONFLICT" });
  });

  it("requires a meaningful out-of-sample Sharpe margin instead of merely above zero", async () => {
    const result = await service(valid({ outOfSampleSharpe: 0.2 })).policy.evaluate(input);
    expect(result).toMatchObject({ allowed: false, reason: "QUANT_OUT_OF_SAMPLE_EDGE_MISSING" });
  });

  it("rejects Monte Carlo evidence derived from too few independent trades", async () => {
    const result = await service(valid({
      metricsJson: {
        sampleEvidence: { totalTrades: 5, outOfSampleTrades: 1, walkForwardWindows: 1 },
        outOfSample: { outOfSampleTrades: 1 },
        walkForward: { windows: [{}] },
        executionAssumptions: { leverage: 1, riskPerTrade: 0.02, riskRewardRatio: 1.5 },
      },
    })).policy.evaluate(input);
    expect(result).toMatchObject({ allowed: false, reason: "QUANT_SAMPLE_TOO_SMALL" });
  });

  it("rejects research assumptions that do not match current live risk settings", async () => {
    const policy = serviceWithLimits(valid(), {
      maxLeverage: 50,
      riskPerTrade: 0.01,
      riskRewardRatio: 2,
    });
    const result = await policy.evaluate(input);
    expect(result).toMatchObject({ allowed: false, reason: "QUANT_ASSUMPTION_MISMATCH" });
  });

  it("reports WAIT as not evaluated instead of a misleading Quant pass", async () => {
    const { policy, findFirst } = service(valid());
    const result = await policy.evaluate({
      ...input,
      decision: { decision: "WAIT", regime: { type: "RANGING" } } as never,
    });

    expect(result).toEqual({
      allowed: false,
      evaluated: false,
      reason: "QUANT_NOT_APPLICABLE",
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("requires validation for the exact selected strategy", async () => {
    const { policy, findFirst } = service(valid());
    await policy.evaluate({ ...input, strategyKey: "trend" });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ strategyKey: "trend" }) as unknown,
    }));
  });
});
