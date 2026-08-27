import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import {
  DecisionInputSchema,
  DecisionOutputSchema,
  DecisionRunInputSchema,
  type AgentDataQuality,
  type DecisionInput,
  type DecisionOutput,
  type FusionInput,
  type MarketRegime,
} from "@platform/shared";
import { FusionService } from "./fusion.service";
import type {
  AnalystName,
  Bias,
  ConflictLevel,
  RunDecisionOptions,
  Weighting,
} from "../../domain/types/decision-service.types";
import {
  BASE_WEIGHTS,
  DECISION_THRESHOLDS,
  QUALITY_FACTOR,
  REGIME_FACTOR,
} from "../../domain/constants/decision.constants";
import { PrismaService } from "../../../../database/prisma.service";
import { calibrateConfidenceWithFallback } from "../../../reflection/domain/confidence-calibration";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";

export type { AnalystName, Bias, ConflictLevel, RunDecisionOptions, Weighting };

@Injectable()
export class DecisionService {
  private readonly logger = new Logger(DecisionService.name);
  private readonly calibrationCache = new Map<
    string,
    {
      expiresAt: number;
      value: ReturnType<typeof calibrateConfidenceWithFallback>;
    }
  >();

  constructor(
    private readonly fusionService: FusionService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  public async run(options: RunDecisionOptions): Promise<DecisionOutput> {
    const input = DecisionRunInputSchema.parse(options.input);
    const result = await this.fusionService.runDetailed({ ...options, input });
    return this.decideForUser(
      {
        symbol: input.symbol,
        fusionOutput: result.fusionOutput,
        ...result.analyses,
      },
      options.userId,
      {
        pipelineRunId: options.correlationId,
        provider: input.provider,
        timeframe: input.interval,
      },
    );
  }

  /** Apply the user's governed live configuration to already-computed analyses. */
  public async decideForUser(
    rawInput: DecisionInput,
    userId?: string,
    metadata: {
      pipelineRunId?: string;
      provider?: "BINANCE_FUTURES" | "OKX_FUTURES";
      timeframe?: string;
      referencePrice?: number;
    } = {},
  ): Promise<DecisionOutput> {
    const config =
      userId && this.prisma
        ? await this.prisma.selfLearningConfiguration.findUnique({
            where: { userId },
          })
        : null;
    const canaryPercent =
      this.configService?.get<number>("SELF_LEARNING_CANARY_PERCENT", 10) ?? 10;
    const canaryBucket = metadata.pipelineRunId
      ? parseInt(
          createHash("sha256")
            .update(metadata.pipelineRunId)
            .digest("hex")
            .slice(0, 8),
          16,
        ) % 100
      : 100;
    const useCanary = Boolean(
      config?.canaryEnabled &&
      config.canaryVersion &&
      canaryBucket < canaryPercent,
    );
    const liveWeights = this.validWeights(
      useCanary ? config?.canaryWeightsJson : config?.weightsJson,
    );
    const decision = this.decide(
      rawInput,
      config
        ? {
            weights: liveWeights,
            confidenceThreshold: useCanary
              ? (config.canaryThreshold ?? config.confidenceThreshold)
              : config.confidenceThreshold,
            volatilityPenalty: config.volatilityPenalty,
          }
        : undefined,
    );
    const confidenceCalibration = await this.confidenceCalibration(
      userId,
      rawInput.symbol,
      decision.confidence,
      metadata.provider,
      metadata.timeframe,
      decision.regime.type,
    );
    const empiricalProbability = this.exactEmpiricalProbability(
      confidenceCalibration,
    );
    const expectedWinProbability = this.clamp(empiricalProbability ?? 0.5, 0, 1);
    // A neutral prior is not empirical edge. Keep EV/PF neutral until an exact
    // or governed blended calibration has enough evidence; downstream Judge
    // and Risk gates will therefore reject cold-start automatic execution.
    const expectedValue = empiricalProbability === undefined
      ? 0
      : this.clamp(
          expectedWinProbability * decision.expectedReward -
            (1 - expectedWinProbability) * decision.expectedLoss -
            decision.executionCost,
          -3,
          3,
        );
    const profitFactorEstimate = empiricalProbability === undefined
      ? 1
      : this.clamp(
          (expectedWinProbability * decision.expectedReward) /
            Math.max((1 - expectedWinProbability) * decision.expectedLoss, 0.05),
          0.1,
          10,
        );
    const calibratedDecision: DecisionOutput = {
      ...decision,
      confidenceCalibration,
      expectedWinProbability: Number(expectedWinProbability.toFixed(3)),
      expectedValue: Number(expectedValue.toFixed(3)),
      profitFactorEstimate: Number(profitFactorEstimate.toFixed(3)),
      ...(config
        ? {
            learningConfiguration: {
              version: useCanary ? config.canaryVersion! : config.liveVersion,
              stage: useCanary ? ("CANARY" as const) : ("LIVE" as const),
            },
          }
        : {}),
    };

    // Phase C: Shadow Mode Simulation Run
    if (config?.shadowEnabled && userId && this.prisma) {
      const shadowWeights = this.validWeights(config.shadowWeightsJson);
      const shadowThreshold = config.shadowThreshold ?? undefined;

      const shadowDecision = this.decide(rawInput, {
        weights: shadowWeights,
        confidenceThreshold: shadowThreshold,
        volatilityPenalty: config.volatilityPenalty,
      });

      if (shadowDecision.decision !== "WAIT") {
        let lastPrice = metadata.referencePrice ?? 0;
        if (!(lastPrice > 0) && metadata.provider) {
          const lastCandle = await this.prisma.marketCandle.findFirst({
            where: {
              symbol: rawInput.symbol,
              provider: metadata.provider,
              isClosed: true,
            },
            orderBy: { closeTime: "desc" },
            select: { close: true },
          });
          if (lastCandle) lastPrice = Number(lastCandle.close);
        }

        if (lastPrice > 0)
          await this.prisma.paperSignal
            .create({
              data: {
                userId,
                pipelineRunId: metadata.pipelineRunId,
                symbol: rawInput.symbol,
                provider: metadata.provider,
                decision: shadowDecision.decision,
                confidence: shadowDecision.confidence,
                mode: "SHADOW",
                configurationVersion:
                  config.shadowVersion ?? config.liveVersion + 1,
                marketRegime: shadowDecision.regime.type,
                referencePrice: lastPrice,
                outcome: "PENDING",
              },
            })
            .catch((err: unknown) => {
              if (err instanceof Error) {
                this.logger.warn(
                  `Failed to record shadow signal: ${err.message}`,
                );
              }
            });
      }
    }

    return calibratedDecision;
  }

  /** Recalibrate the strategy selected by the portfolio layer. */
  public async calibrateForExecution(
    decision: DecisionOutput,
    userId: string,
    metadata: {
      symbol: string;
      strategyKey: string;
      provider?: "BINANCE_FUTURES" | "OKX_FUTURES";
      timeframe?: string;
    },
  ): Promise<DecisionOutput> {
    const confidenceCalibration = await this.confidenceCalibration(
      userId,
      metadata.symbol,
      decision.confidence,
      metadata.provider,
      metadata.timeframe,
      decision.regime.type,
      metadata.strategyKey,
    );
    const empiricalProbability = this.exactEmpiricalProbability(
      confidenceCalibration,
    );
    const expectedWinProbability = this.clamp(
      empiricalProbability ?? 0.5,
      0,
      1,
    );
    const hasEmpiricalEdge = empiricalProbability !== undefined;
    return {
      ...decision,
      confidenceCalibration,
      expectedWinProbability: Number(expectedWinProbability.toFixed(3)),
      expectedValue: Number(
        (hasEmpiricalEdge
          ? this.clamp(
              expectedWinProbability * decision.expectedReward -
                (1 - expectedWinProbability) * decision.expectedLoss -
                decision.executionCost,
              -3,
              3,
            )
          : 0
        ).toFixed(3),
      ),
      profitFactorEstimate: Number(
        (hasEmpiricalEdge
          ? this.clamp(
              (expectedWinProbability * decision.expectedReward) /
                Math.max(
                  (1 - expectedWinProbability) * decision.expectedLoss,
                  0.05,
                ),
              0.1,
              10,
            )
          : 1
        ).toFixed(3),
      ),
    };
  }

  private async confidenceCalibration(
    userId: string | undefined,
    symbol: string,
    rawScore: number,
    provider?: "BINANCE_FUTURES" | "OKX_FUTURES",
    timeframe?: string,
    regime?: "TRENDING" | "RANGING" | "HIGH_VOLATILITY",
    strategyKey?: string,
  ) {
    if (!userId || !this.prisma)
      return calibrateConfidenceWithFallback(rawScore, []);
    const key = `${userId}:${symbol}:${strategyKey ?? "ANY"}:${provider ?? "ANY"}:${timeframe ?? "ANY"}:${regime ?? "ANY"}:${Math.floor(rawScore / 10)}`;
    const cached = this.calibrationCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const rows = await this.prisma.performanceRecord.findMany({
      where: {
        userId,
        horizon: this.calibrationHorizon(strategyKey, timeframe),
        decision: { in: ["LONG", "SHORT"] },
        outcome: { in: ["CORRECT", "WRONG"] },
      },
      select: {
        symbol: true,
        confidence: true,
        outcome: true,
        marketRegime: true,
        run: {
          select: { provider: true, timeframe: true, storedContext: true },
        },
      },
      orderBy: { evaluatedAt: "desc" },
      take: 2000,
    });
    const strategyOf = (storedContext: unknown): string | undefined => {
      if (
        !storedContext ||
        typeof storedContext !== "object" ||
        Array.isArray(storedContext)
      )
        return undefined;
      const context = storedContext as Record<string, unknown>;
      const candidate = context.candidateDecision;
      if (
        candidate &&
        typeof candidate === "object" &&
        !Array.isArray(candidate)
      ) {
        const value = (candidate as Record<string, unknown>).strategyKey;
        if (typeof value === "string") return value;
      }
      const selection = context.strategySelection;
      if (
        selection &&
        typeof selection === "object" &&
        !Array.isArray(selection)
      ) {
        const value = (selection as Record<string, unknown>)
          .selectedStrategyKey;
        if (typeof value === "string") return value;
      }
      return undefined;
    };
    const records = rows.map((row) => ({
      ...row,
      strategyKey: strategyOf(row.run.storedContext),
    }));
    const asCalibrationRecords = (items: typeof records) =>
      items.map((row) => ({
        confidence: row.confidence,
        outcome: row.outcome,
      }));
    const sameStrategy = (row: (typeof records)[number]) =>
      !strategyKey || row.strategyKey === strategyKey;
    const sameProvider = (row: (typeof records)[number]) =>
      !provider || row.run.provider === provider;
    const sameTimeframe = (row: (typeof records)[number]) =>
      !timeframe || row.run.timeframe === timeframe;
    const sameRegime = (row: (typeof records)[number]) =>
      !regime || row.marketRegime === regime;
    const value = calibrateConfidenceWithFallback(rawScore, [
      {
        scope: "EXACT",
        records: asCalibrationRecords(
          records.filter(
            (row) =>
              row.symbol === symbol &&
              sameStrategy(row) &&
              sameProvider(row) &&
              sameTimeframe(row) &&
              sameRegime(row),
          ),
        ),
      },
      {
        scope: "STRATEGY_CONTEXT",
        records: asCalibrationRecords(
          records.filter(
            (row) =>
              sameStrategy(row) &&
              sameProvider(row) &&
              sameTimeframe(row) &&
              sameRegime(row),
          ),
        ),
      },
      {
        scope: "STRATEGY_TIMEFRAME",
        records: asCalibrationRecords(
          records.filter((row) => sameStrategy(row) && sameTimeframe(row)),
        ),
      },
      { scope: "USER_GLOBAL", records: asCalibrationRecords(records) },
    ]);
    if (this.calibrationCache.size >= 500) {
      const oldest = this.calibrationCache.keys().next().value;
      if (oldest) this.calibrationCache.delete(oldest);
    }
    this.calibrationCache.set(key, {
      // Performance outcomes arrive continuously; a short cache prevents a
      // newly evaluated move from being hidden for several pipeline cycles.
      expiresAt: Date.now() + 30_000,
      value,
    });
    return value;
  }

  private exactEmpiricalProbability(
    calibration: Awaited<ReturnType<DecisionService["confidenceCalibration"]>>,
  ): number | undefined {
    return calibration.status === "CALIBRATED" &&
      (calibration.scope === "EXACT" || calibration.scope === "BLENDED") &&
      calibration.hardGateEligible !== false
      ? (calibration.empiricalProbability ?? undefined)
      : undefined;
  }

  private calibrationHorizon(strategyKey?: string, timeframe?: string) {
    const minutes = (() => {
      const match = /^(\d+)([mhd])$/i.exec(timeframe ?? "15m");
      if (!match) return 15;
      const amount = Number(match[1]);
      const unit = match[2]?.toLowerCase();
      return amount * (unit === "d" ? 1440 : unit === "h" ? 60 : 1);
    })();
    if (strategyKey === "momentum-scalp") return minutes <= 5 ? "M15" : "M30";
    if (strategyKey === "trend") return minutes <= 15 ? "H2" : "H4";
    if (strategyKey === "breakout") return minutes <= 15 ? "MID" : "H2";
    if (strategyKey === "mean-reversion") return minutes <= 15 ? "M30" : "MID";
    return minutes <= 5
      ? "M30"
      : minutes <= 15
        ? "MID"
        : minutes <= 60
          ? "H2"
          : "H4";
  }

  private validWeights(value: unknown): Weighting | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const names = Object.keys(BASE_WEIGHTS) as AnalystName[];
    const candidate = value as Record<string, unknown>;
    if (
      !names.every(
        (name) =>
          typeof candidate[name] === "number" &&
          Number.isFinite(candidate[name]) &&
          Number(candidate[name]) > 0,
      )
    ) {
      this.logger.warn({ event: "invalid_self_learning_weights_ignored" });
      return undefined;
    }
    const total = names.reduce((sum, name) => sum + Number(candidate[name]), 0);
    if (!(total > 0)) return undefined;
    return Object.fromEntries(
      names.map((name) => [name, (Number(candidate[name]) / total) * 100]),
    ) as Weighting;
  }

  public decide(
    rawInput: DecisionInput,
    customOptions?: {
      weights?: Weighting;
      confidenceThreshold?: number;
      volatilityPenalty?: number;
    },
  ): DecisionOutput {
    const input = DecisionInputSchema.parse(rawInput);
    const names = (Object.keys(BASE_WEIGHTS) as AnalystName[]).filter(
      (name) => name !== "macro" || this.macroConfigured(input),
    );
    const regime = this.detectRegime(input);
    const weighting = this.dynamicWeights(regime.type, customOptions?.weights);
    const active = names.filter((name) => {
      const output = input[name];
      return output !== undefined && output.dataQuality !== "INSUFFICIENT";
    });
    const votes = new Map<AnalystName, Bias>(
      active.map((name) => [
        name,
        this.bias(name, input[name] as FusionInput[AnalystName]),
      ]),
    );
    const activeWeight = active.reduce((sum, name) => sum + weighting[name], 0);
    const voteWeight = (bias: Bias) =>
      active.reduce(
        (sum, name) => sum + (votes.get(name) === bias ? weighting[name] : 0),
        0,
      );
    const bullishWeight = voteWeight("BULLISH");
    const bearishWeight = voteWeight("BEARISH");
    const neutralWeight = voteWeight("NEUTRAL");
    const directionalWeight = bullishWeight + bearishWeight;
    const bullishCount = active.filter(
      (name) => votes.get(name) === "BULLISH",
    ).length;
    const bearishCount = active.filter(
      (name) => votes.get(name) === "BEARISH",
    ).length;
    const directionalCount = bullishCount + bearishCount;
    // Neutral observations describe coverage/context; they are not votes
    // against a directional setup. Normalize direction only over agents that
    // actually expressed a direction, then account for sparse coverage via the
    // separate evidenceCoverage and data-quality controls below.
    const rawDirectionalBias = directionalWeight
      ? ((bullishWeight - bearishWeight) / directionalWeight) * 100
      : 0;
    const overrides: string[] = [];
    const newsShock = this.newsShock(input, overrides);
    const directionalBias = this.clamp(
      rawDirectionalBias + newsShock,
      -100,
      100,
    );
    const conflictLevel = this.conflictLevel(votes, rawDirectionalBias);

    let candidate: DecisionOutput["decision"] = "WAIT";
    if (
      directionalBias >= DECISION_THRESHOLDS.DIRECTIONAL_BIAS_THRESHOLD &&
      bullishCount > bearishCount
    )
      candidate = "LONG";
    if (
      directionalBias <= -DECISION_THRESHOLDS.DIRECTIONAL_BIAS_THRESHOLD &&
      bearishCount > bullishCount
    )
      candidate = "SHORT";

    if (
      input.news?.impact.level === "HIGH" &&
      input.news.impact.direction === "NEGATIVE"
    ) {
      candidate = rawDirectionalBias <= 10 ? "SHORT" : "WAIT";
      overrides.push(
        candidate === "SHORT"
          ? "High-impact negative news overrode the normal weighted candidate toward SHORT."
          : "High-impact negative news conflicted with bullish evidence and forced WAIT.",
      );
    } else if (
      input.news?.impact.level === "HIGH" &&
      input.news.impact.direction === "POSITIVE" &&
      directionalBias >= DECISION_THRESHOLDS.DIRECTIONAL_BIAS_THRESHOLD &&
      bullishCount >= bearishCount
    ) {
      candidate = "LONG";
      overrides.push(
        "High-impact positive news increased the bias toward LONG.",
      );
    }

    const alignedCount =
      candidate === "LONG"
        ? bullishCount
        : candidate === "SHORT"
          ? bearishCount
          : Math.max(
              bullishCount,
              bearishCount,
              active.length - bullishCount - bearishCount,
            );
    const agreementScore = active.length
      ? Math.round((alignedCount / active.length) * 100)
      : 0;
    // Neutral context is coverage, not directional opposition. Keep the legacy
    // all-agent agreement score for telemetry, while execution policies use
    // directional agreement together with an explicit coverage score.
    const directionalAgreement = candidate === "LONG"
      ? (directionalCount ? Math.round((bullishCount / directionalCount) * 100) : 0)
      : candidate === "SHORT"
        ? (directionalCount ? Math.round((bearishCount / directionalCount) * 100) : 0)
        : agreementScore;
    const evidenceCoverage = Math.round(
      (active.length / Math.max(this.expectedAnalystCount(input), 1)) * 100,
    );
    const alignedWeight =
      candidate === "LONG"
        ? bullishWeight
        : candidate === "SHORT"
          ? bearishWeight
          : Math.max(bullishWeight, bearishWeight, neutralWeight);
    const alignmentDenominator = candidate === "WAIT"
      ? activeWeight
      : directionalWeight;
    const baseScore = alignmentDenominator
      ? (alignedWeight / alignmentDenominator) * 100
      : 0;
    const dataQuality = this.dataQuality(input, active);
    const coreDataQuality = this.coreDataQuality(input);
    const { adjustment: volatilityAdjustment, extreme } = this.volatilityFilter(
      input,
      customOptions?.volatilityPenalty,
    );
    if (volatilityAdjustment < 0) {
      overrides.push(
        `High volatility reduced confidence by ${Math.abs(volatilityAdjustment)}%.`,
      );
    }
    if (extreme) overrides.push("Extreme volatility forced WAIT.");

    if (conflictLevel === "MEDIUM") {
      overrides.push(
        "Medium signal conflict reduced the composite confidence score by 10 points.",
      );
    }
    if (conflictLevel === "HIGH")
      overrides.push("Strong signal conflict forced WAIT.");

    // Check core analyst alignment (Market + Technical)
    const marketBias = votes.get("market");
    const techBias = votes.get("technical");
    const targetBias: Bias =
      candidate === "LONG"
        ? "BULLISH"
        : candidate === "SHORT"
          ? "BEARISH"
          : "NEUTRAL";
    const coreAgree =
      candidate !== "WAIT" &&
      marketBias === targetBias &&
      techBias === targetBias;
    if (coreAgree)
      overrides.push(
        "Market and Technical trend alignment boosted confidence by +10%.",
      );

    // Composite confidence score. This is not a win probability; the separate
    // confidenceCalibration field carries empirical probability when ready.
    const qualityDeduction =
      dataQuality === "PARTIAL"
        ? DECISION_THRESHOLDS.QUALITY_PARTIAL_DEDUCTION
        : dataQuality === "INSUFFICIENT"
          ? DECISION_THRESHOLDS.QUALITY_INSUFFICIENT_DEDUCTION
          : 0;
    const conflictDeduction =
      conflictLevel === "MEDIUM"
        ? DECISION_THRESHOLDS.CONFLICT_MEDIUM_PENALTY
        : conflictLevel === "HIGH"
          ? DECISION_THRESHOLDS.CONFLICT_HIGH_PENALTY
          : 0;
    const volDeduction = Math.abs(volatilityAdjustment);
    const coreBonus = coreAgree
      ? DECISION_THRESHOLDS.CORE_TREND_ALIGNMENT_BONUS
      : 0;
    const convictionBonus =
      directionalAgreement >= 80 && evidenceCoverage >= 60 && baseScore >= 70
        ? 8
        : directionalAgreement >= 70 && evidenceCoverage >= 60 && baseScore >= 60
          ? 4
          : 0;

    const rawConfidence =
      baseScore +
      coreBonus +
      convictionBonus -
      qualityDeduction -
      conflictDeduction -
      volDeduction;
    // WAIT is still a decision: retain the composite confidence in staying out.
    // Truly insufficient evidence is reduced by the quality deduction below,
    // instead of every neutral market being displayed as an unexplained 0/100.
    const confidenceCeiling =
      dataQuality === "PARTIAL"
        ? DECISION_THRESHOLDS.PARTIAL_DATA_CONFIDENCE_CEILING
        : 100;
    const confidence = Math.round(
      this.clamp(rawConfidence, 0, confidenceCeiling),
    );

    const minConfidence =
      customOptions?.confidenceThreshold ??
      DECISION_THRESHOLDS.MINIMUM_CONFIDENCE_THRESHOLD;
    if (confidence < minConfidence && candidate !== "WAIT") {
      overrides.push(
        `Composite confidence below ${minConfidence} forced WAIT.`,
      );
    }
    if (dataQuality === "INSUFFICIENT")
      overrides.push("Insufficient data forced WAIT.");

    const signals = this.signals(input, votes, weighting);
    const risks = this.risks(input, votes, dataQuality, conflictLevel);
    const opportunityScore = this.calculateOpportunityScore(
      input,
      regime,
      votes,
      weighting,
      dataQuality,
    );
    const { adaptiveThreshold, calibrationAdjustment } =
      this.calculateAdaptiveThresholds(
        input,
        regime,
        confidence,
        opportunityScore,
        conflictLevel,
      );
    const calibratedConfidence = this.clamp(
      confidence + calibrationAdjustment,
      0,
      confidenceCeiling,
    );
    // Composite confidence is not a win probability. Until reflection has
    // enough outcomes, use a neutral prior and let the Judge block auto-trading.
    const expectedWinProbability = 0.5;
    const expectedReward = this.clamp(
      (opportunityScore / 100) * 3 + 0.5,
      0.2,
      5,
    );
    const expectedLoss = this.clamp(
      ((100 - opportunityScore) / 100) * 1.4 + 0.4,
      0.2,
      3,
    );
    const grossExpectedValue =
      expectedWinProbability * expectedReward -
      (1 - expectedWinProbability) * expectedLoss;
    const profitFactorEstimate = this.clamp(
      (expectedWinProbability * expectedReward) /
        Math.max((1 - expectedWinProbability) * expectedLoss, 0.05),
      0.1,
      10,
    );
    const riskScore = this.clamp(
      50 +
        volatilityAdjustment * -0.4 +
        (conflictLevel === "HIGH" ? 15 : conflictLevel === "MEDIUM" ? 8 : 0) +
        Math.max(0, 100 - opportunityScore) * 0.2,
      0,
      100,
    );
    const executionCost = this.estimateExecutionCost(
      input,
      opportunityScore,
      regime.type,
    );
    const expectedValue = this.clamp(grossExpectedValue - executionCost, -3, 3);
    const strongConviction =
      coreDataQuality === "GOOD" &&
      directionalAgreement >= 80 &&
      evidenceCoverage >= 60 &&
      opportunityScore >= 68 &&
      expectedValue > 0.2;
    // A learned threshold may make the system more conservative, but must not
    // weaken the regime-specific safety threshold.
    const adaptiveThresholdValue = Math.max(
      customOptions?.confidenceThreshold ?? 0,
      adaptiveThreshold,
    );
    const finalDecision: DecisionOutput["decision"] =
      dataQuality === "INSUFFICIENT" ||
      conflictLevel === "HIGH" ||
      extreme ||
      calibratedConfidence < adaptiveThresholdValue ||
      (expectedValue <= 0 && !strongConviction) ||
      (opportunityScore < Math.max(55, adaptiveThresholdValue - 5) &&
        !strongConviction)
        ? "WAIT"
        : candidate;

    if (strongConviction && finalDecision !== "WAIT") {
      overrides.push(
        "Strong conviction satisfied the secondary opportunity guard while all confidence and safety thresholds remained enforced.",
      );
    }
    const weightedBias =
      directionalBias > 0
        ? "bullish"
        : directionalBias < 0
          ? "bearish"
          : "neutral";
    const output = DecisionOutputSchema.parse({
      decision: finalDecision,
      confidence: Math.round(calibratedConfidence),
      confidenceKind: "COMPOSITE_SCORE",
      reasoning: `${active.length} of ${this.expectedAnalystCount(input)} configured analysts supplied usable data. The ${regime.type.toLowerCase().replace("_", " ")} regime produced a normalized ${weightedBias} bias of ${Math.round(directionalBias)}, ${directionalAgreement}% directional agreement, ${evidenceCoverage}% evidence coverage, and ${Math.round(baseScore)}% weighted alignment. The composite confidence score is ${Math.round(calibratedConfidence)} with ${dataQuality} overall data, ${coreDataQuality} core data, and ${conflictLevel} conflict; it is not a win probability.`,
      signals,
      risks,
      agreementScore,
      directionalAgreement,
      evidenceCoverage,
      coreDataQuality,
      dataQuality,
      regime,
      weighting,
      overrides: [...new Set(overrides)],
      volatilityAdjustment,
      conflictLevel,
      opportunityScore: Math.round(opportunityScore),
      expectedWinProbability: Number(expectedWinProbability.toFixed(3)),
      expectedReward: Number(expectedReward.toFixed(3)),
      expectedLoss: Number(expectedLoss.toFixed(3)),
      expectedValue: Number(expectedValue.toFixed(3)),
      profitFactorEstimate: Number(profitFactorEstimate.toFixed(3)),
      riskScore: Math.round(riskScore),
      adaptiveThreshold: Math.round(adaptiveThreshold),
      calibrationAdjustment: Number(calibrationAdjustment.toFixed(2)),
      executionCost: Number(executionCost.toFixed(3)),
      generatedAt: new Date().toISOString(),
    });

    this.logger.log({
      event: "decision_consensus_calculated",
      symbol: input.symbol,
      decision: output.decision,
      regime: regime.type,
      weighting,
      overrides: output.overrides,
      conflicts: input.fusionOutput.conflicts,
      conflictLevel,
      confidenceCalculation: {
        baseScore: Math.round(baseScore * 100) / 100,
        coreBonus,
        qualityDeduction,
        conflictDeduction,
        volDeduction,
        dataQualityFactor: QUALITY_FACTOR[dataQuality],
        regimeFactor: REGIME_FACTOR[regime.type],
        activeAgentFactor: active.length / names.length,
        finalConfidence: confidence,
      },
    });
    return output;
  }

  private detectRegime(input: DecisionInput): MarketRegime {
    const volatilityEvidence = [
      input.market?.volatility.atr,
      ...(input.market?.anomalies ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (
      input.market?.volatility.level === "HIGH" ||
      /high atr|extreme atr|large swings?|volatility spike/.test(
        volatilityEvidence,
      )
    )
      return { type: "HIGH_VOLATILITY" };
    if (input.market?.volatility.level === "LOW") return { type: "RANGING" };
    if (
      input.market?.trend.direction === "SIDEWAYS" ||
      input.technical?.trend.direction === "SIDEWAYS"
    )
      return { type: "RANGING" };
    if (
      input.market?.trend.strength === "STRONG" ||
      input.technical?.trend.strength === "STRONG"
    )
      return { type: "TRENDING" };
    return { type: "RANGING" };
  }

  private dynamicWeights(
    regime: MarketRegime["type"],
    customWeights?: Weighting,
  ): Weighting {
    const weights = { ...(customWeights || BASE_WEIGHTS) };
    if (regime === "TRENDING") {
      weights.technical += 5;
      weights.news -= 5;
    } else if (regime === "HIGH_VOLATILITY") {
      weights.market += 5;
      weights.sentiment += 5;
      weights.technical -= 5;
    } else {
      weights.technical += 5;
      weights.market -= 5;
    }
    for (const name of Object.keys(weights) as AnalystName[])
      weights[name] = Math.max(1, weights[name]);
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    const normalized = {} as Weighting;
    const names = Object.keys(weights) as AnalystName[];
    names.forEach((name) => {
      normalized[name] = Math.round((weights[name] / total) * 10_000) / 100;
    });
    const normalizedTotal = Object.values(normalized).reduce(
      (sum, value) => sum + value,
      0,
    );
    normalized.onchain =
      Math.round((normalized.onchain + 100 - normalizedTotal) * 100) / 100;
    return normalized;
  }

  private newsShock(input: DecisionInput, overrides: string[]): number {
    if (input.news?.impact.level !== "HIGH") return 0;
    if (input.news.impact.direction === "NEGATIVE") {
      overrides.push("Applied a -20 directional news-shock adjustment.");
      return DECISION_THRESHOLDS.NEWS_NEGATIVE_SHOCK;
    }
    if (input.news.impact.direction === "POSITIVE") {
      overrides.push("Applied a +10 directional news-shock adjustment.");
      return DECISION_THRESHOLDS.NEWS_POSITIVE_SHOCK;
    }
    return 0;
  }

  private volatilityFilter(
    input: DecisionInput,
    customPenalty?: number,
  ): {
    factor: number;
    adjustment: number;
    extreme: boolean;
  } {
    const penalty = customPenalty ?? 20;
    const evidence = [
      input.market?.volatility.atr,
      ...(input.market?.anomalies ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const high =
      input.market?.volatility.level === "HIGH" ||
      /high atr|extreme atr|large swings?|volatility spike/.test(evidence);
    if (!high) return { factor: 1, adjustment: 0, extreme: false };
    const extreme =
      /extreme|liquidation cascade|dislocation|violent|flash crash|parabolic spike/.test(
        evidence,
      );
    return extreme
      ? { factor: 0.7, adjustment: -Math.round(penalty * 1.5), extreme: true }
      : { factor: 0.8, adjustment: -Math.round(penalty), extreme: false };
  }

  private agreementFactor(
    candidate: DecisionOutput["decision"],
    aligned: number,
    active: number,
  ): number {
    if (active === 0 || candidate === "WAIT") return 0.3;
    const ratio = aligned / active;
    if (ratio === 1) return 1;
    return ratio >= 0.5 ? ratio : 0.3;
  }

  private conflictLevel(
    votes: Map<AnalystName, Bias>,
    directionalBias: number,
  ): ConflictLevel {
    const opposing = (left: AnalystName, right: AnalystName) => {
      const first = votes.get(left);
      const second = votes.get(right);
      return (
        (first === "BULLISH" && second === "BEARISH") ||
        (first === "BEARISH" && second === "BULLISH")
      );
    };
    const namedConflicts =
      Number(opposing("technical", "sentiment")) +
      Number(opposing("market", "news"));
    const values = [...votes.values()];
    const hasBothDirections =
      values.includes("BULLISH") && values.includes("BEARISH");
    if (
      namedConflicts >= 2 ||
      (hasBothDirections &&
        Math.abs(directionalBias) <
          DECISION_THRESHOLDS.DIRECTIONAL_BIAS_THRESHOLD)
    )
      return "HIGH";
    if (namedConflicts === 1 || hasBothDirections) return "MEDIUM";
    return "LOW";
  }

  private dataQuality(
    input: DecisionInput,
    active: AnalystName[],
  ): AgentDataQuality {
    const expectedCount = this.expectedAnalystCount(input);
    if (
      input.fusionOutput.dataQuality === "INSUFFICIENT" ||
      active.length < Math.min(3, expectedCount)
    ) {
      return "INSUFFICIENT";
    }
    if (
      input.fusionOutput.dataQuality === "GOOD" &&
      active.length === expectedCount &&
      active.every((name) => input[name]?.dataQuality === "GOOD")
    )
      return "GOOD";
    return "PARTIAL";
  }

  private coreDataQuality(input: DecisionInput): AgentDataQuality {
    const qualities = [input.market?.dataQuality, input.technical?.dataQuality];
    if (qualities.every((quality) => quality === "GOOD")) return "GOOD";
    if (qualities.some((quality) => quality === "INSUFFICIENT" || quality === undefined)) {
      return "INSUFFICIENT";
    }
    return "PARTIAL";
  }

  private expectedAnalystCount(input: DecisionInput): number {
    const onChainConfigured = !input.onchain?.signals.some((signal) =>
      /no verified on-chain (?:provider|analysis)|coin metrics returned no verified coverage/i.test(
        signal,
      ),
    );
    const macroConfigured = this.macroConfigured(input);
    return (onChainConfigured ? 6 : 5) - (macroConfigured ? 0 : 1);
  }

  private macroConfigured(input: DecisionInput): boolean {
    return !/no imported macro data/i.test(input.macro?.summary ?? "");
  }

  private calculateOpportunityScore(
    input: DecisionInput,
    regime: MarketRegime,
    votes: Map<AnalystName, Bias>,
    weighting: Weighting,
    quality: AgentDataQuality,
  ): number {
    const trendStrength =
      input.market?.trend.strength === "STRONG"
        ? 1
        : input.technical?.trend.strength === "STRONG"
          ? 0.9
          : 0.65;
    const momentum =
      input.technical?.momentum.rsiState === "OVERSOLD" ||
      input.technical?.momentum.rsiState === "OVERBOUGHT"
        ? 0.75
        : 0.85;
    const volume = input.market?.liquidity?.volumeProfile === true ? 0.8 : 0.7;
    const liquidity =
      input.market?.liquidity?.spread !== undefined ? 0.8 : 0.65;
    const atr =
      input.market?.volatility.level === "LOW"
        ? 0.7
        : input.market?.volatility.level === "HIGH"
          ? 0.55
          : 0.75;
    const funding = input.market?.derivatives?.fundingRate ? 0.75 : 0.7;
    const openInterest = input.market?.derivatives?.openInterest ? 0.8 : 0.7;
    const structure =
      input.technical?.structure.marketStructure === "HH_HL" ||
      input.technical?.structure.marketStructure === "LH_LL" ||
      input.technical?.structure.marketStructure === "LL_LH"
        ? 0.85
        : 0.7;
    const higherTimeframe =
      regime.type === "TRENDING"
        ? 0.9
        : regime.type === "HIGH_VOLATILITY"
          ? 0.6
          : 0.75;
    const newsImpact =
      input.news?.impact.level === "HIGH"
        ? 0.7
        : input.news?.impact.level === "MEDIUM"
          ? 0.8
          : 0.65;
    const sentiment =
      input.sentiment?.sentiment.overall === "BULLISH"
        ? 0.8
        : input.sentiment?.sentiment.overall === "BEARISH"
          ? 0.7
          : 0.6;
    const macro =
      input.macro?.macroTrend === "RISK_ON"
        ? 0.8
        : input.macro?.macroTrend === "RISK_OFF"
          ? 0.6
          : 0.7;
    const patternSimilarity = Math.max(0.55, 0.7 + (votes.size / 10) * 0.05);
    const evidenceQualityPrior =
      quality === "GOOD" ? 0.8 : quality === "PARTIAL" ? 0.65 : 0.5;
    const riskReward = input.market?.volatility.level === "LOW" ? 0.8 : 0.7;
    const executionCost = 0.72;
    const confidence = this.clamp(
      (this.voteWeight(votes, weighting) / 100) * 0.95 + 0.05,
      0,
      1,
    );
    const weightedScore =
      trendStrength * 12 +
      momentum * 10 +
      volume * 8 +
      liquidity * 8 +
      atr * 8 +
      funding * 7 +
      openInterest * 7 +
      structure * 8 +
      higherTimeframe * 8 +
      newsImpact * 7 +
      sentiment * 6 +
      macro * 6 +
      patternSimilarity * 7 +
      evidenceQualityPrior * 8 +
      riskReward * 8 +
      executionCost * 6 +
      confidence * 10;
    return this.clamp((weightedScore / 134) * 100, 0, 100);
  }

  private calculateAdaptiveThresholds(
    input: DecisionInput,
    regime: MarketRegime,
    confidence: number,
    opportunityScore: number,
    conflictLevel: DecisionOutput["conflictLevel"],
  ): { adaptiveThreshold: number; calibrationAdjustment: number } {
    const base =
      regime.type === "TRENDING"
        ? 62
        : regime.type === "HIGH_VOLATILITY"
          ? 78
          : 72;
    const volatilityAdjustment =
      input.market?.volatility.level === "HIGH"
        ? 8
        : input.market?.volatility.level === "LOW"
          ? -3
          : 0;
    const liquidityAdjustment = this.spreadThresholdAdjustment(
      input.market?.liquidity?.bidAskSpread ?? input.market?.liquidity?.spread,
    );
    const opportunityAdjustment =
      opportunityScore < 65 ? 9 : opportunityScore > 80 ? -4 : 0;
    const conflictAdjustment =
      conflictLevel === "HIGH" ? 7 : conflictLevel === "MEDIUM" ? 3 : 0;
    const threshold = this.clamp(
      base +
        volatilityAdjustment +
        liquidityAdjustment +
        opportunityAdjustment +
        conflictAdjustment,
      55,
      90,
    );
    const calibrationAdjustment =
      confidence > threshold ? 4 : confidence < threshold - 8 ? -6 : 0;
    return { adaptiveThreshold: threshold, calibrationAdjustment };
  }

  private spreadThresholdAdjustment(raw: string | undefined): number {
    const spreadBps = this.spreadBasisPoints(raw);
    if (spreadBps === undefined) return 0;
    if (spreadBps <= 2) return -2;
    if (spreadBps <= 5) return 0;
    if (spreadBps <= 10) return 2;
    return 5;
  }

  private spreadBasisPoints(raw: string | undefined): number | undefined {
    if (!raw) return undefined;
    const normalized = raw.replace(/[%,$]|bps?/gi, "").trim();
    if (!normalized) return undefined;
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric < 0) return undefined;
    return raw.includes("%") ? numeric * 100 : numeric;
  }

  private estimateExecutionCost(
    input: DecisionInput,
    opportunityScore: number,
    regime: MarketRegime["type"],
  ): number {
    const spreadBps = this.spreadBasisPoints(
      input.market?.liquidity?.bidAskSpread ?? input.market?.liquidity?.spread,
    );
    const spreadPenalty =
      spreadBps !== undefined ? Math.min(0.25, spreadBps / 1000) : 0.05;
    const volatilityPenalty = regime === "HIGH_VOLATILITY" ? 0.1 : 0.04;
    const slippage = Math.max(
      0.01,
      spreadPenalty + volatilityPenalty + (100 - opportunityScore) / 1000,
    );
    return Number(slippage.toFixed(3));
  }

  private voteWeight(
    votes: Map<AnalystName, Bias>,
    weighting: Weighting,
  ): number {
    const bullishWeight = [...votes.entries()].reduce(
      (sum, [name, vote]) => sum + (vote === "BULLISH" ? weighting[name] : 0),
      0,
    );
    const bearishWeight = [...votes.entries()].reduce(
      (sum, [name, vote]) => sum + (vote === "BEARISH" ? weighting[name] : 0),
      0,
    );
    const directionalWeight = bullishWeight + bearishWeight;
    return directionalWeight > 0
      ? this.clamp(
          (Math.max(bullishWeight, bearishWeight) / directionalWeight) * 100,
          0,
          100,
        )
      : 0;
  }

  private bias(name: AnalystName, output: FusionInput[AnalystName]): Bias {
    switch (name) {
      case "market": {
        const value = output as FusionInput["market"];
        return value.trend.direction === "UP"
          ? "BULLISH"
          : value.trend.direction === "DOWN"
            ? "BEARISH"
            : "NEUTRAL";
      }
      case "technical": {
        const value = output as FusionInput["technical"];
        return value.trend.direction === "UP"
          ? "BULLISH"
          : value.trend.direction === "DOWN"
            ? "BEARISH"
            : "NEUTRAL";
      }
      case "news": {
        const value = output as FusionInput["news"];
        return value.impact.direction === "POSITIVE"
          ? "BULLISH"
          : value.impact.direction === "NEGATIVE"
            ? "BEARISH"
            : "NEUTRAL";
      }
      case "sentiment":
        return (output as FusionInput["sentiment"]).sentiment.overall;
      case "macro": {
        const trend = (output as FusionInput["macro"]).macroTrend;
        return trend === "RISK_ON"
          ? "BULLISH"
          : trend === "RISK_OFF"
            ? "BEARISH"
            : "NEUTRAL";
      }
      case "onchain": {
        const value = output as FusionInput["onchain"];
        const evidence = [
          ...value.signals,
          value.flows.exchangeInflow,
          value.flows.exchangeOutflow,
        ]
          .filter((item): item is string => Boolean(item))
          .join(" ")
          .toLowerCase();
        const bullish =
          /bullish|accumulat|net outflow|outflow (?:is )?(?:high|rising|increas)/.test(
            evidence,
          );
        const bearish =
          /bearish|distribut|net inflow|inflow (?:is )?(?:high|rising|increas)/.test(
            evidence,
          );
        return bullish === bearish
          ? "NEUTRAL"
          : bullish
            ? "BULLISH"
            : "BEARISH";
      }
    }
  }

  private signals(
    input: DecisionInput,
    votes: Map<AnalystName, Bias>,
    weighting: Weighting,
  ) {
    const bullishFactors: string[] = [];
    const bearishFactors: string[] = [];
    votes.forEach((vote, name) => {
      const factor = `${this.label(name)} (${weighting[name]}%): ${input[name]?.summary}`;
      if (vote === "BULLISH") bullishFactors.push(factor);
      if (vote === "BEARISH") bearishFactors.push(factor);
    });
    return { bullishFactors, bearishFactors };
  }

  private risks(
    input: DecisionInput,
    votes: Map<AnalystName, Bias>,
    quality: AgentDataQuality,
    conflictLevel: ConflictLevel,
  ): string[] {
    const risks = new Set<string>();
    const values = [...votes.values()];
    if (values.includes("BULLISH") && values.includes("BEARISH")) {
      risks.add(
        `${conflictLevel} conflict between directional analyst signals.`,
      );
    }
    if (quality !== "GOOD")
      risks.add(`Decision data quality is ${quality.toLowerCase()}.`);
    if (this.detectRegime(input).type === "HIGH_VOLATILITY")
      risks.add("High market volatility is present.");
    if (
      input.news?.impact.level === "HIGH" ||
      input.news?.keyEvents.some((event) => event.importance >= 80)
    ) {
      risks.add("A major news event may cause abrupt market repricing.");
    }
    input.news?.riskSignals.forEach((risk) => risks.add(risk));
    input.macro?.riskFactors.forEach((risk) => risks.add(risk));
    input.fusionOutput.conflicts.forEach((risk) => risks.add(risk));
    return [...risks];
  }

  private clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }

  private label(name: AnalystName): string {
    return name === "onchain"
      ? "On-chain"
      : `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  }
}
