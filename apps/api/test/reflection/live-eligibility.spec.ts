import { describe, expect, it } from "vitest";
import {
  evaluateLiveEligibility,
  computeConfigurationHash,
} from "../../src/modules/reflection/domain/live-eligibility";

const passing = {
  outOfSampleAccuracy: 0.55,
  expectancy: 0.000_001,
  profitFactor: 1.3,
  sharpeRatio: 0.5,
  maxDrawdownPct: 10,
  shadowTrades: 100,
  canaryTrades: 100,
};

describe("evaluateLiveEligibility", () => {
  it("returns eligible for all-passing metrics", () => {
    expect(evaluateLiveEligibility(passing)).toEqual({ eligible: true, failures: [] });
  });

  it("rejects OOS accuracy below 55%", () => {
    expect(evaluateLiveEligibility({ ...passing, outOfSampleAccuracy: 0.549 })).toMatchObject({
      eligible: false,
      failures: ["OOS_ACCURACY_BELOW_55_PERCENT"],
    });
  });

  it("rejects zero expectancy", () => {
    expect(evaluateLiveEligibility({ ...passing, expectancy: 0 })).toMatchObject({
      eligible: false,
      failures: ["EXPECTANCY_NOT_POSITIVE"],
    });
  });

  it("rejects negative expectancy", () => {
    expect(evaluateLiveEligibility({ ...passing, expectancy: -0.001 })).toMatchObject({
      eligible: false,
      failures: ["EXPECTANCY_NOT_POSITIVE"],
    });
  });

  it("rejects profit factor below 1.3", () => {
    expect(evaluateLiveEligibility({ ...passing, profitFactor: 1.299 })).toMatchObject({
      eligible: false,
      failures: ["PROFIT_FACTOR_BELOW_1_3"],
    });
  });

  it("rejects Sharpe below 0.5", () => {
    expect(evaluateLiveEligibility({ ...passing, sharpeRatio: 0.499 })).toMatchObject({
      eligible: false,
      failures: ["SHARPE_RATIO_BELOW_0_5"],
    });
  });

  it("rejects drawdown above 10%", () => {
    expect(evaluateLiveEligibility({ ...passing, maxDrawdownPct: 10.001 })).toMatchObject({
      eligible: false,
      failures: ["MAX_DRAWDOWN_EXCEEDS_10_PERCENT"],
    });
  });

  it("rejects shadow trades below 100", () => {
    expect(evaluateLiveEligibility({ ...passing, shadowTrades: 99 })).toMatchObject({
      eligible: false,
      failures: ["SHADOW_TRADES_BELOW_100"],
    });
  });

  it("rejects canary trades below 100", () => {
    expect(evaluateLiveEligibility({ ...passing, canaryTrades: 99 })).toMatchObject({
      eligible: false,
      failures: ["CANARY_TRADES_BELOW_100"],
    });
  });

  it("rejects NaN values as failures", () => {
    const result = evaluateLiveEligibility({ ...passing, sharpeRatio: NaN });
    expect(result.eligible).toBe(false);
    expect(result.failures).toContain("SHARPE_RATIO_BELOW_0_5");
  });

  it("rejects infinite values as failures", () => {
    const result = evaluateLiveEligibility({ ...passing, maxDrawdownPct: Infinity });
    expect(result.eligible).toBe(false);
    expect(result.failures).toContain("MAX_DRAWDOWN_EXCEEDS_10_PERCENT");
  });

  it("returns multiple failures in stable order", () => {
    const result = evaluateLiveEligibility({
      ...passing,
      outOfSampleAccuracy: 0,
      expectancy: -1,
      profitFactor: 0,
    });
    expect(result.eligible).toBe(false);
    expect(result.failures).toEqual([
      "OOS_ACCURACY_BELOW_55_PERCENT",
      "EXPECTANCY_NOT_POSITIVE",
      "PROFIT_FACTOR_BELOW_1_3",
    ]);
  });
});

describe("computeConfigurationHash", () => {
  const baseConfig = {
    version: 1,
    weights: { technical: 0.4, market: 0.3, news: 0.3 },
    confidenceThreshold: 0.65,
    policyVersion: "live-eligibility-v1",
    advisoryPolicyHash: "advisory-disabled",
  };

  it("returns a 64-character lowercase hex string", () => {
    const hash = computeConfigurationHash(baseConfig);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is independent of weight key order", () => {
    const reversed = {
      ...baseConfig,
      weights: { news: 0.3, market: 0.3, technical: 0.4 },
    };
    expect(computeConfigurationHash(baseConfig)).toBe(computeConfigurationHash(reversed));
  });

  it("changes when version changes", () => {
    expect(computeConfigurationHash(baseConfig)).not.toBe(
      computeConfigurationHash({ ...baseConfig, version: 2 }),
    );
  });

  it("changes when confidenceThreshold changes", () => {
    expect(computeConfigurationHash(baseConfig)).not.toBe(
      computeConfigurationHash({ ...baseConfig, confidenceThreshold: 0.7 }),
    );
  });

  it("changes when a weight changes", () => {
    expect(computeConfigurationHash(baseConfig)).not.toBe(
      computeConfigurationHash({ ...baseConfig, weights: { technical: 0.5, market: 0.3, news: 0.2 } }),
    );
  });
});
