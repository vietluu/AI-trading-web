import { createHash } from "crypto";

export const STRICT_LIVE_ELIGIBILITY_THRESHOLDS = Object.freeze({
  minOutOfSampleAccuracy: 0.55,
  minExpectancyExclusive: 0,
  minProfitFactor: 1.3,
  minSharpeRatio: 0.5,
  maxDrawdownPct: 10,
  minShadowTrades: 100,
  minCanaryTrades: 100,
});

export const LIVE_ELIGIBILITY_POLICY_VERSION = "live-eligibility-v1";

export interface LiveEligibilityMetrics {
  outOfSampleAccuracy: number;
  expectancy: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  shadowTrades: number;
  canaryTrades: number;
}

export interface LiveEligibilityResult {
  eligible: boolean;
  failures: string[];
}

const safeNumber = (value: number): number =>
  Number.isFinite(value) ? value : NaN;

export function evaluateLiveEligibility(
  metrics: LiveEligibilityMetrics,
): LiveEligibilityResult {
  const t = STRICT_LIVE_ELIGIBILITY_THRESHOLDS;
  const failures: string[] = [];

  const oos = safeNumber(metrics.outOfSampleAccuracy);
  if (!Number.isFinite(oos) || oos < t.minOutOfSampleAccuracy) {
    failures.push("OOS_ACCURACY_BELOW_55_PERCENT");
  }

  const exp = safeNumber(metrics.expectancy);
  if (!Number.isFinite(exp) || exp <= t.minExpectancyExclusive) {
    failures.push("EXPECTANCY_NOT_POSITIVE");
  }

  const pf = safeNumber(metrics.profitFactor);
  if (!Number.isFinite(pf) || pf < t.minProfitFactor) {
    failures.push("PROFIT_FACTOR_BELOW_1_3");
  }

  const sharpe = safeNumber(metrics.sharpeRatio);
  if (!Number.isFinite(sharpe) || sharpe < t.minSharpeRatio) {
    failures.push("SHARPE_RATIO_BELOW_0_5");
  }

  const drawdown = safeNumber(metrics.maxDrawdownPct);
  if (!Number.isFinite(drawdown) || drawdown > t.maxDrawdownPct) {
    failures.push("MAX_DRAWDOWN_EXCEEDS_10_PERCENT");
  }

  const shadow = safeNumber(metrics.shadowTrades);
  if (!Number.isFinite(shadow) || shadow < t.minShadowTrades) {
    failures.push("SHADOW_TRADES_BELOW_100");
  }

  const canary = safeNumber(metrics.canaryTrades);
  if (!Number.isFinite(canary) || canary < t.minCanaryTrades) {
    failures.push("CANARY_TRADES_BELOW_100");
  }

  return { eligible: failures.length === 0, failures };
}

export interface ConfigurationHashInput {
  version: number;
  weights: Record<string, number>;
  confidenceThreshold: number;
  policyVersion: string;
  advisoryPolicyHash: string;
}

export function computeConfigurationHash(
  config: ConfigurationHashInput,
): string {
  const sortedWeights = Object.fromEntries(
    Object.entries(config.weights).sort(([a], [b]) => a.localeCompare(b)),
  );

  const canonical = JSON.stringify({
    version: config.version,
    weights: sortedWeights,
    confidenceThreshold: config.confidenceThreshold,
    policyVersion: config.policyVersion,
    advisoryPolicyHash: config.advisoryPolicyHash,
  });

  return createHash("sha256").update(canonical).digest("hex");
}
