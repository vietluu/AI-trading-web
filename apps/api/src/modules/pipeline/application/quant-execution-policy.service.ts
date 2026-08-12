import { Injectable } from "@nestjs/common";
import type { DecisionOutput } from "@platform/shared";
import { PrismaService } from "../../../database/prisma.service";
import { timeframeMilliseconds } from "../domain/adaptive-trading-policy";

export interface QuantExecutionPolicyResult {
  allowed: boolean;
  reason?: "QUANT_VALIDATION_MISSING" | "QUANT_VALIDATION_STALE" |
    "QUANT_WALK_FORWARD_UNSTABLE" | "QUANT_PROBABILITY_TOO_LOW" |
    "QUANT_RUIN_RISK_TOO_HIGH" | "QUANT_OUT_OF_SAMPLE_EDGE_MISSING" |
    "QUANT_CALIBRATION_UNRELIABLE" | "QUANT_REGIME_CONFLICT" |
    "QUANT_POLICY_UNAVAILABLE";
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
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(input: {
    userId: string;
    symbol: string;
    provider: string;
    timeframe: string;
    strategyKey?: string;
    decision: Pick<DecisionOutput, "decision" | "regime">;
    now?: Date;
  }): Promise<QuantExecutionPolicyResult> {
    if (input.decision.decision === "WAIT") return { allowed: true };
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
    if (!validation) return { allowed: false, reason: "QUANT_VALIDATION_MISSING" };
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
      return { allowed: false, reason: "QUANT_VALIDATION_STALE", validation: evidence };
    if (!validation.walkForwardStable)
      return { allowed: false, reason: "QUANT_WALK_FORWARD_UNSTABLE", validation: evidence };
    if (validation.probabilityOfProfit < 52)
      return { allowed: false, reason: "QUANT_PROBABILITY_TOO_LOW", validation: evidence };
    if (validation.probabilityOfRuin > 5)
      return { allowed: false, reason: "QUANT_RUIN_RISK_TOO_HIGH", validation: evidence };
    if (validation.outOfSampleSharpe <= 0)
      return { allowed: false, reason: "QUANT_OUT_OF_SAMPLE_EDGE_MISSING", validation: evidence };
    if (validation.confidenceBrierScore > 0.3)
      return { allowed: false, reason: "QUANT_CALIBRATION_UNRELIABLE", validation: evidence };

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
    return { allowed: true, validation: evidence, ...(regimeEvidence ? { regime: regimeEvidence } : {}) };
  }
}
