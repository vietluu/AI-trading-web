import { Injectable, Optional } from "@nestjs/common";
import type { DecisionOutput } from "@platform/shared";
import { PrismaService } from "../../../database/prisma.service";
import { timeframeMilliseconds } from "../domain/adaptive-trading-policy";
import { RiskConfigService } from "../../risk/application/risk-config.service";

export interface QuantExecutionPolicyResult {
  allowed: boolean;
  evaluated?: boolean;
  advisory?: boolean;
  reason?: "QUANT_VALIDATION_MISSING" | "QUANT_VALIDATION_STALE" |
    "QUANT_WALK_FORWARD_UNSTABLE" | "QUANT_PROBABILITY_TOO_LOW" |
    "QUANT_RUIN_RISK_TOO_HIGH" | "QUANT_OUT_OF_SAMPLE_EDGE_MISSING" |
    "QUANT_CALIBRATION_UNRELIABLE" | "QUANT_REGIME_CONFLICT" |
    "QUANT_POLICY_UNAVAILABLE" | "QUANT_NOT_APPLICABLE" |
    "QUANT_SAMPLE_TOO_SMALL" | "QUANT_ASSUMPTION_MISMATCH";
  validation?: {
    probabilityOfProfit: number;
    probabilityOfRuin: number;
    outOfSampleSharpe: number;
    walkForwardStable: boolean;
    confidenceBrierScore: number;
    createdAt: string;
  };
  regime?: { value: string; confidence: number; detectedAt: string };
}

/** Turns persisted quant research into a deterministic auto-execution gate. */
@Injectable()
export class QuantExecutionPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly riskConfig?: RiskConfigService,
  ) {}

  async evaluate(input: {
    userId: string;
    symbol: string;
    provider: string;
    timeframe: string;
    strategyKey?: string;
    decision: Pick<DecisionOutput, "decision" | "regime">;
    now?: Date;
  }): Promise<QuantExecutionPolicyResult> {
    if (input.decision.decision === "WAIT") {
      return {
        allowed: false,
        evaluated: false,
        reason: "QUANT_NOT_APPLICABLE",
      };
    }
    const now = input.now ?? new Date();
    const [validation, regime] = await Promise.all([
      this.prisma.researchValidationRun.findFirst({
        where: {
          userId: input.userId,
          strategyKey: input.strategyKey ?? 'ai-core',
          symbol: input.symbol,
          provider: input.provider,
          interval: input.timeframe,
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.marketRegimeState.findFirst({
        where: { symbol: input.symbol, provider: input.provider, interval: input.timeframe },
        orderBy: { detectedAt: "desc" },
      }),
    ]);
    if (!validation) return this.insufficientEvidence("QUANT_VALIDATION_MISSING");
    const metrics = validation.metricsJson && typeof validation.metricsJson === "object" && !Array.isArray(validation.metricsJson)
      ? validation.metricsJson as Record<string, unknown>
      : {};
    const sampleEvidence = metrics.sampleEvidence && typeof metrics.sampleEvidence === "object" && !Array.isArray(metrics.sampleEvidence)
      ? metrics.sampleEvidence as Record<string, unknown>
      : {};
    const outOfSample = metrics.outOfSample && typeof metrics.outOfSample === "object" && !Array.isArray(metrics.outOfSample)
      ? metrics.outOfSample as Record<string, unknown>
      : {};
    const walkForward = metrics.walkForward && typeof metrics.walkForward === "object" && !Array.isArray(metrics.walkForward)
      ? metrics.walkForward as Record<string, unknown>
      : {};
    const windows = Array.isArray(walkForward.windows) ? walkForward.windows.length : 0;
    const assumptions = metrics.executionAssumptions && typeof metrics.executionAssumptions === "object" && !Array.isArray(metrics.executionAssumptions)
      ? metrics.executionAssumptions as Record<string, unknown>
      : undefined;
    const calibration = metrics.calibration && typeof metrics.calibration === "object" && !Array.isArray(metrics.calibration)
      ? metrics.calibration as Record<string, unknown>
      : undefined;
    const evidence = {
      probabilityOfProfit: validation.probabilityOfProfit,
      probabilityOfRuin: validation.probabilityOfRuin,
      outOfSampleSharpe: validation.outOfSampleSharpe,
      walkForwardStable: validation.walkForwardStable,
      confidenceBrierScore: validation.confidenceBrierScore,
      createdAt: validation.createdAt.toISOString(),
    };
    const maxAge = Math.max(36 * 3_600_000, timeframeMilliseconds(input.timeframe) * 12);
    if (now.getTime() - validation.createdAt.getTime() > maxAge)
      return { ...this.insufficientEvidence("QUANT_VALIDATION_STALE"), validation: evidence };
    // Negative evidence is actionable even when the sample is immature. In
    // particular, a small sample must never hide an unstable walk-forward run,
    // high ruin probability, or negative out-of-sample edge.
    if (!validation.walkForwardStable)
      return { allowed: false, reason: "QUANT_WALK_FORWARD_UNSTABLE", validation: evidence };
    if (validation.probabilityOfProfit < 52)
      return { allowed: false, reason: "QUANT_PROBABILITY_TOO_LOW", validation: evidence };
    if (validation.probabilityOfRuin > 5)
      return { allowed: false, reason: "QUANT_RUIN_RISK_TOO_HIGH", validation: evidence };
    if (validation.outOfSampleSharpe <= 0.3)
      return { allowed: false, reason: "QUANT_OUT_OF_SAMPLE_EDGE_MISSING", validation: evidence };
    if (calibration?.evidenceSufficient === true && validation.confidenceBrierScore > 0.3)
      return { allowed: false, reason: "QUANT_CALIBRATION_UNRELIABLE", validation: evidence };
    const liveLimits = await this.riskConfig?.getUserLimits(input.userId);
    if (!assumptions || (liveLimits && (
      Number(assumptions.leverage) !== liveLimits.maxLeverage ||
      Math.abs(Number(assumptions.riskPerTrade) - liveLimits.riskPerTrade) > 1e-9 ||
      Math.abs(Number(assumptions.riskRewardRatio) - liveLimits.riskRewardRatio) > 1e-9
    ))) return { ...this.insufficientEvidence("QUANT_ASSUMPTION_MISMATCH"), validation: evidence };
    if (
      Number(sampleEvidence.totalTrades ?? 0) < 30 ||
      Number(sampleEvidence.outOfSampleTrades ?? outOfSample.outOfSampleTrades ?? 0) < 10 ||
      Number(sampleEvidence.walkForwardWindows ?? windows) < 5
    ) return { ...this.insufficientEvidence("QUANT_SAMPLE_TOO_SMALL"), validation: evidence };

    const regimeEvidence = regime
      ? { value: regime.regime, confidence: regime.confidence, detectedAt: regime.detectedAt.toISOString() }
      : undefined;
    const regimeFresh = regime && now.getTime() - regime.detectedAt.getTime() <=
      Math.max(30 * 60_000, timeframeMilliseconds(input.timeframe) * 2);
    if (regimeFresh && regime.confidence >= 65) {
      const conflict =
        (regime.regime === "BULL" && input.decision.decision === "SHORT") ||
        (regime.regime === "BEAR" && input.decision.decision === "LONG") ||
        (regime.regime === "SIDEWAYS" && input.decision.regime.type !== "RANGING") ||
        (regime.regime === "HIGH_VOLATILITY" && input.decision.regime.type !== "HIGH_VOLATILITY");
      if (conflict)
        return { allowed: false, reason: "QUANT_REGIME_CONFLICT", validation: evidence, regime: regimeEvidence };
    }
    return {
      allowed: true,
      evaluated: true,
      validation: evidence,
      ...(regimeEvidence ? { regime: regimeEvidence } : {}),
    };
  }

  /** Automatic exchange execution fails closed until applicable evidence exists. */
  private insufficientEvidence(
    reason: "QUANT_VALIDATION_MISSING" | "QUANT_SAMPLE_TOO_SMALL" |
      "QUANT_ASSUMPTION_MISMATCH" | "QUANT_VALIDATION_STALE",
  ): QuantExecutionPolicyResult {
    return { allowed: false, evaluated: false, reason };
  }
}
