import { Injectable, Optional } from "@nestjs/common";
import type { DecisionOutput } from "@platform/shared";
import { PrismaService } from "../../../database/prisma.service";
import { evaluateEvidenceGate } from '../domain/evidence-gate';
import { timeframeMilliseconds } from "../domain/adaptive-trading-policy";
import { RiskConfigService } from "../../risk/application/risk-config.service";

export interface QuantExecutionPolicyResult {
  severity: 'BLOCK' | 'REDUCE_SIZE' | 'APPROVE';
  allowed: boolean;
  evaluated?: boolean;
  advisory?: boolean;
  dislocationCanary?: boolean;
  sizeFactor?: number;
  reason?: "QUANT_VALIDATION_MISSING" | "QUANT_VALIDATION_STALE" |
    "QUANT_WALK_FORWARD_UNSTABLE" | "QUANT_PROBABILITY_TOO_LOW" |
    "QUANT_RUIN_RISK_TOO_HIGH" | "QUANT_OUT_OF_SAMPLE_EDGE_MISSING" |
    "QUANT_CALIBRATION_UNRELIABLE" | "QUANT_REGIME_CONFLICT" |
    "QUANT_POLICY_UNAVAILABLE" | "QUANT_NOT_APPLICABLE" |
    "QUANT_SAMPLE_TOO_SMALL" | "QUANT_ASSUMPTION_MISMATCH";
  reasons?: string[];
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
    mode?: "SHADOW" | "DEMO" | "LIVE";
    decision: Pick<DecisionOutput,
      "decision" | "regime" | "confidence" | "opportunityScore" |
      "expectedValue" | "riskScore" | "volatilityAdjustment" |
      "dataQuality" | "coreDataQuality" | "directionalAgreement" |
      "evidenceCoverage" | "conflictLevel" | "expectedReward" |
      "expectedLoss" | "executionCost"
    >;
    multiTimeframeConfirmation?: number;
    primaryRsi?: number;
    marketEventImpact?: "LOW" | "MEDIUM" | "HIGH";
    marketEventDirection?: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
    marketDislocation?: {
      direction: "BULLISH" | "BEARISH";
      confirmationCount: number;
      indicatorCloseTime: string;
      reasons: string[];
    };
    now?: Date;
  }): Promise<QuantExecutionPolicyResult> {
    if (input.decision.decision === "WAIT") {
      return { severity: 'BLOCK', allowed: false, evaluated: false, reason: 'QUANT_NOT_APPLICABLE' };
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
    const regimeEvidence = regime
      ? { value: regime.regime, confidence: regime.confidence, detectedAt: regime.detectedAt.toISOString() }
      : undefined;
      
    if (this.hasFreshRegimeConflict(input, regime, now)) {
      return { severity: 'BLOCK', allowed: false, reason: "QUANT_REGIME_CONFLICT", ...(regimeEvidence ? { regime: regimeEvidence } : {}) };
    }
    
    const liveLimits = await this.riskConfig?.getUserLimits(input.userId);
    let assumptionMismatch = false;
    let newCohort = false;
    let negativeExactCohort = false;
    let evidence = undefined;
    
    if (validation) {
      const metrics = validation.metricsJson && typeof validation.metricsJson === "object" && !Array.isArray(validation.metricsJson)
        ? validation.metricsJson as Record<string, unknown> : {};
      const sampleEvidence = metrics.sampleEvidence && typeof metrics.sampleEvidence === "object" && !Array.isArray(metrics.sampleEvidence)
        ? metrics.sampleEvidence as Record<string, unknown> : {};
      const outOfSample = metrics.outOfSample && typeof metrics.outOfSample === "object" && !Array.isArray(metrics.outOfSample)
        ? metrics.outOfSample as Record<string, unknown> : {};
      const assumptions = metrics.executionAssumptions && typeof metrics.executionAssumptions === "object" && !Array.isArray(metrics.executionAssumptions)
        ? metrics.executionAssumptions as Record<string, unknown> : undefined;
        
      evidence = {
        probabilityOfProfit: validation.probabilityOfProfit,
        probabilityOfRuin: validation.probabilityOfRuin,
        outOfSampleSharpe: validation.outOfSampleSharpe,
        walkForwardStable: validation.walkForwardStable,
        confidenceBrierScore: validation.confidenceBrierScore,
        createdAt: validation.createdAt.toISOString(),
      };
      
      const maxAge = Math.max(36 * 3_600_000, timeframeMilliseconds(input.timeframe) * 12);
      const isStale = now.getTime() - validation.createdAt.getTime() > maxAge;
      newCohort = Number(sampleEvidence.totalTrades ?? 0) < 30 || Number(sampleEvidence.outOfSampleTrades ?? outOfSample.outOfSampleTrades ?? 0) < 10;
      negativeExactCohort = !isStale && !newCohort && (!validation.walkForwardStable || validation.probabilityOfProfit < 52 || validation.probabilityOfRuin > 15 || validation.outOfSampleSharpe <= 0.8);
      assumptionMismatch = !assumptions || !liveLimits ||
        ['leverage', 'riskPerTrade', 'riskRewardRatio'].some((key) => !Number.isFinite(Number(assumptions[key]))) || (liveLimits !== null && liveLimits !== undefined && (
        Number(assumptions.leverage) !== liveLimits.maxLeverage ||
        Math.abs(Number(assumptions.riskPerTrade) - liveLimits.riskPerTrade) > 1e-9 ||
        Math.abs(Number(assumptions.riskRewardRatio) - liveLimits.riskRewardRatio) > 1e-9
      ));
    } else {
      newCohort = true; 
      assumptionMismatch = false;
    }
    
    const gateResult = evaluateEvidenceGate({
      mode: input.mode ?? 'DEMO',
      negativeExactCohort,
      newCohort,
      assumptionMismatch,
    });
    
    if (gateResult.severity === 'BLOCK') {
       let reason: NonNullable<QuantExecutionPolicyResult['reason']> = 'QUANT_VALIDATION_MISSING';
       if (!validation) reason = 'QUANT_VALIDATION_MISSING';
       else if (gateResult.reasons.includes('ASSUMPTION_MISMATCH_LIVE')) reason = 'QUANT_ASSUMPTION_MISMATCH';
       else if (gateResult.reasons.includes('NEW_COHORT_LIVE')) reason = 'QUANT_SAMPLE_TOO_SMALL';
       else if (gateResult.reasons.includes('NEGATIVE_EXACT_COHORT')) {
           reason = !validation.walkForwardStable ? 'QUANT_WALK_FORWARD_UNSTABLE' : validation.probabilityOfProfit < 52 ? 'QUANT_PROBABILITY_TOO_LOW' : validation.probabilityOfRuin > 15 ? 'QUANT_RUIN_RISK_TOO_HIGH' : 'QUANT_OUT_OF_SAMPLE_EDGE_MISSING';

       }
       return { severity: 'BLOCK', allowed: false, evaluated: false, reason, validation: evidence, reasons: gateResult.reasons };
    }
    
    const applyGate = (res: QuantExecutionPolicyResult): QuantExecutionPolicyResult => {
      if (res.severity === 'BLOCK') return { ...res, reasons: gateResult.reasons };
      if (gateResult.severity === 'REDUCE_SIZE') {
        const currentSize = res.sizeFactor ?? 1.0;
        return {
          ...res,
          severity: 'REDUCE_SIZE',
          sizeFactor: Math.min(currentSize, gateResult.sizeFactor ?? 1.0),
          reasons: Array.from(new Set([...(res.reasons ?? []), ...gateResult.reasons]))
        };
      }
      return { ...res, reasons: gateResult.reasons };
    };
    
    if (!validation) return applyGate(this.insufficientEvidence("QUANT_VALIDATION_MISSING", input));
    
    const maxAge = Math.max(36 * 3_600_000, timeframeMilliseconds(input.timeframe) * 12);
    if (now.getTime() - validation.createdAt.getTime() > maxAge)
      return applyGate({ ...this.insufficientEvidence("QUANT_VALIDATION_STALE", input), validation: evidence });
      
    if (newCohort) {
      return applyGate({ ...this.insufficientEvidence("QUANT_SAMPLE_TOO_SMALL", input), validation: evidence });
    }

    if (assumptionMismatch) {
      return applyGate({ ...this.insufficientEvidence("QUANT_ASSUMPTION_MISMATCH", input), validation: evidence });
    }
      

    if (validation.probabilityOfRuin > 15) {
      return applyGate({ severity: 'BLOCK', allowed: false, reason: "QUANT_RUIN_RISK_TOO_HIGH", validation: evidence });
    }
    if (validation.outOfSampleSharpe <= 0.8) {
      return applyGate({ severity: 'BLOCK', allowed: false, reason: "QUANT_OUT_OF_SAMPLE_EDGE_MISSING", validation: evidence });
    }
    
    const metrics = validation.metricsJson && typeof validation.metricsJson === "object" && !Array.isArray(validation.metricsJson)
      ? validation.metricsJson as Record<string, unknown> : {};
    const calibration = metrics.calibration && typeof metrics.calibration === "object" && !Array.isArray(metrics.calibration)
      ? metrics.calibration as Record<string, unknown> : undefined;
      
    if (calibration?.evidenceSufficient === true && validation.confidenceBrierScore > 0.3)
      return applyGate({ severity: 'BLOCK', allowed: false, reason: "QUANT_CALIBRATION_UNRELIABLE", validation: evidence });

    return applyGate({
      severity: 'APPROVE',
      allowed: true,
      evaluated: true,
      validation: evidence,
      ...(regimeEvidence ? { regime: regimeEvidence } : {}),
    });
  }
  /** Automatic exchange execution fails closed until applicable evidence exists. */
  private insufficientEvidence(
    reason: "QUANT_VALIDATION_MISSING" | "QUANT_SAMPLE_TOO_SMALL" |
      "QUANT_ASSUMPTION_MISMATCH" | "QUANT_VALIDATION_STALE",
    input: {
      mode?: "SHADOW" | "DEMO" | "LIVE";
      decision: Pick<DecisionOutput,
        "decision" | "regime" | "confidence" | "opportunityScore" |
        "expectedValue" | "riskScore" | "volatilityAdjustment" |
        "dataQuality" | "coreDataQuality" | "directionalAgreement" |
        "evidenceCoverage" | "conflictLevel"
      >;
      multiTimeframeConfirmation?: number;
      primaryRsi?: number;
      marketEventImpact?: "LOW" | "MEDIUM" | "HIGH";
      marketEventDirection?: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
    },
  ): QuantExecutionPolicyResult {
    if (input.mode === "LIVE") {
      return { severity: 'BLOCK', allowed: false, evaluated: false, reason };
    }
    const sizeFactor = this.boundedCanarySizeFactor(input);
    if (sizeFactor !== undefined) {
      return {
        severity: 'REDUCE_SIZE',
        allowed: true,
        evaluated: false,
        advisory: true,
        reason,
        sizeFactor,
      };
    }
    return { severity: 'BLOCK', allowed: false, evaluated: false, reason };
  }

  private boundedCanarySizeFactor(input: {
    decision: Pick<DecisionOutput,
      "decision" | "regime" | "confidence" | "opportunityScore" |
      "expectedValue" | "riskScore" | "volatilityAdjustment" |
      "dataQuality" | "coreDataQuality" | "directionalAgreement" |
      "evidenceCoverage" | "conflictLevel"
    >;
    multiTimeframeConfirmation?: number;
    primaryRsi?: number;
    marketEventImpact?: "LOW" | "MEDIUM" | "HIGH";
    marketEventDirection?: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  }): number | undefined {
    const { decision } = input;
    const eventAligned = input.marketEventImpact === "HIGH" &&
      ((decision.decision === "LONG" && input.marketEventDirection === "POSITIVE") ||
        (decision.decision === "SHORT" && input.marketEventDirection === "NEGATIVE"));
    const eligible = decision.decision !== "WAIT" &&
      decision.confidence >= (eventAligned ? 72 : 75) &&
      decision.opportunityScore >= 68 &&
      decision.expectedValue > 0.2 &&
      decision.riskScore < 80 &&
      decision.volatilityAdjustment > -30 &&
      decision.regime.type !== "HIGH_VOLATILITY" &&
      decision.dataQuality !== "INSUFFICIENT" &&
      decision.conflictLevel !== "HIGH" &&
      (input.multiTimeframeConfirmation ?? 0) >= 80 &&
      (input.primaryRsi === undefined || input.primaryRsi < 80);
    if (!eligible) return undefined;
    // News-driven entries use less risk than the generic cold-start canary.
    return eventAligned ? 0.15 : 0.25;
  }

  private hasFreshRegimeConflict(
    input: {
      timeframe: string;
      decision: Pick<DecisionOutput,
        "decision" | "regime" | "confidence" | "coreDataQuality" |
        "directionalAgreement" | "evidenceCoverage" | "dataQuality" |
        "conflictLevel" | "volatilityAdjustment"
      >;
      multiTimeframeConfirmation?: number;
    },
    regime: { regime: string; confidence: number; detectedAt: Date } | null,
    now: Date,
  ): boolean {
    const fresh = regime && now.getTime() - regime.detectedAt.getTime() <=
      Math.max(30 * 60_000, timeframeMilliseconds(input.timeframe) * 2);
    if (!fresh || regime.confidence < 65) return false;
    const conflicts = (regime.regime === "BULL" && input.decision.decision === "SHORT") ||
      (regime.regime === "BEAR" && input.decision.decision === "LONG") ||
      (regime.regime === "SIDEWAYS" && input.decision.regime.type !== "RANGING") ||
      (regime.regime === "HIGH_VOLATILITY" && input.decision.regime.type !== "HIGH_VOLATILITY");
    if (!conflicts) return false;
    // Regime classifiers intentionally use a slower window. During a genuine
    // transition, fresh aligned core/MTF evidence is allowed to continue to the
    // strategy validation gate; it does not bypass negative validation, risk,
    // spread, or volatility checks.
    const realtimeTransition = regime.regime !== "HIGH_VOLATILITY" &&
      input.decision.coreDataQuality === "GOOD" &&
      (input.decision.directionalAgreement ?? 0) >= 80 &&
      (input.decision.evidenceCoverage ?? 0) >= 60 &&
      input.decision.confidence >= 65 &&
      input.decision.dataQuality !== "INSUFFICIENT" &&
      input.decision.conflictLevel !== "HIGH" &&
      input.decision.volatilityAdjustment > -30 &&
      (input.multiTimeframeConfirmation ?? 0) >= 80;
    return !realtimeTransition;
  }
}
