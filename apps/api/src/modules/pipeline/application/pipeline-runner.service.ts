import { Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ExchangeInterval, ExchangeProvider } from "../../../exchange/domain/exchange.types";
import {
  FusionRunInputSchema,
  type FusionInput,
  type FusionOutput,
} from "@platform/shared";
import { AgentInvocationSource } from "../../agents/domain/enums";
import { FusionService } from "../../agents/application/services/fusion.service";
import { DecisionService } from "../../agents/application/services/decision.service";
import { PipelineRepository } from "../infrastructure/pipeline.repository";
import { PipelineCancellationService } from "../infrastructure/pipeline-cancellation.service";
import { SignalFilterService } from "./signal-filter.service";
import { PipelineAlertService } from "./pipeline-alert.service";
import { DecisionRiskPolicyService } from "../../risk/application/decision-risk-policy.service";
import { PipelineAnalyticsService } from "./pipeline-analytics.service";
import { resolvePipelineDefinition } from "../domain/pipeline.definition";
import type { PipelineJob } from "../infrastructure/pipeline-queue.service";
import { LiveTradingService } from "../../live-trading/application/live-trading.service";
import {
  analysisParams,
  rankStrategyDecisionCandidates,
  selectStrategyDecision,
} from "../../portfolio/domain/strategy-decision";
import { MarketDataService } from "../../../market-data/application/market-data.service";
import { RedisService } from "../../../redis/redis.service";
import { DecisionJudgeService } from "./decision-judge.service";
import { QuantExecutionPolicyService } from "./quant-execution-policy.service";
import { preferredTradePlanAtr, timeframeMilliseconds } from "../domain/adaptive-trading-policy";
import { SettingsService } from "../../../settings/settings.service";
import {
  analyzeMultiTimeframe,
  evaluateMultiTimeframeDecision,
  selectPipelineTimeframes,
} from "../domain/multi-timeframe-analysis";
import { PortfolioService } from "../../portfolio/application/portfolio.service";
import { executeWithSingleDriftReassessment } from "./entry-drift-reassessment";
import { randomUUID } from "node:crypto";
import {
  computeMultiFactorCompositeScore,
  evaluateConfluence,
  type ConfluenceEvaluation,
  type ConfluenceSignal,
  type ConfluenceSizeConfig,
  DEFAULT_CONFLUENCE_SIZE_CONFIG,
} from "../domain/confluence-engine";
import { ConfluenceCollectorService } from "../infrastructure/confluence-collector.service";
import type { DecisionOutput } from "@platform/shared";
import type { TradePlanMarketContext } from "../../risk/domain/trade-plan-engine";

class PipelineCancelledError extends Error {}
class PipelineExecutionLockBusyError extends Error {}
class PipelineExecutionRetryableError extends Error {}

const DISLOCATION_CANARY_ADVISORY_REASONS = new Set([
  "EXPECTED_VALUE_NEGATIVE",
  "EXPECTED_VALUE_TOO_LOW",
  "PROFIT_FACTOR_TOO_LOW",
  "CALIBRATED_PROBABILITY_TOO_LOW",
  "CALIBRATION_UNRELIABLE",
]);

function marketDislocationFromParams(value: unknown): {
  direction: "BULLISH" | "BEARISH";
  confirmationCount: number;
  indicatorCloseTime: string;
  reasons: string[];
} | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const event = value as Record<string, unknown>;
  if (
    (event.direction !== "BULLISH" && event.direction !== "BEARISH") ||
    !Number.isFinite(Number(event.confirmationCount)) ||
    typeof event.indicatorCloseTime !== "string" ||
    !Array.isArray(event.reasons) ||
    !event.reasons.every((reason) => typeof reason === "string")
  ) return undefined;
  return {
    direction: event.direction,
    confirmationCount: Number(event.confirmationCount),
    indicatorCloseTime: event.indicatorCloseTime,
    reasons: event.reasons,
  };
}

function historicalGateReasonsAreAdvisory(reasons: string[]): boolean {
  return reasons.every((reason) =>
    DISLOCATION_CANARY_ADVISORY_REASONS.has(reason),
  );
}

@Injectable()
export class PipelineRunnerService {
  private readonly logger = new Logger(PipelineRunnerService.name);

  constructor(
    private readonly fusion: FusionService,
    private readonly decision: DecisionService,
    private readonly repository: PipelineRepository,
    private readonly cancellation: PipelineCancellationService,
    private readonly riskPolicy: DecisionRiskPolicyService,
    private readonly signalFilter: SignalFilterService,
    private readonly marketData: MarketDataService,
    private readonly alerts: PipelineAlertService,
    private readonly analytics: PipelineAnalyticsService,
    private readonly liveTrading: LiveTradingService,
    private readonly redis: RedisService,
    @Optional() private readonly judge?: DecisionJudgeService,
    @Optional() private readonly settings?: SettingsService,
    @Optional() private readonly quantPolicy?: QuantExecutionPolicyService,
    @Optional() private readonly portfolio?: PortfolioService,
    @Optional() private readonly confluenceCollector?: ConfluenceCollectorService,
  ) {}

  async run(job: PipelineJob): Promise<void> {
    const definition = resolvePipelineDefinition(job.pipelineId);
    if (!definition?.enabled) throw new Error("PIPELINE_NOT_FOUND_OR_DISABLED");
    const startedAt = new Date();
    const symbol = String(job.symbol);
    const runId = String(job.runId);
    await this.repository.updateRun(runId, {
      status: "RUNNING",
      startedAt,
      completedAt: null,
      errorCode: null,
      safeErrorMessage: null,
    });
    await this.assertNotCancelled(runId);
    try {
      const requestedStrategyKeys = Array.isArray(job.params?.strategyIds)
        ? job.params.strategyIds.filter((item): item is string => typeof item === "string")
        : typeof job.params?.strategyId === "string"
          ? [job.params.strategyId]
          : ["ai-core"];
      await this.portfolio?.ensureRegisteredStrategies(
        job.userId,
        requestedStrategyKeys,
        [symbol],
      );
      const eligibleStrategyKeys = await this.repository.activeStrategyKeys(
        job.userId,
        requestedStrategyKeys,
      );
      if (!eligibleStrategyKeys.length) {
        await this.repository.updateRun(runId, {
          status: "SKIPPED",
          decision: "WAIT",
          skippedReason: "NO_ACTIVE_STRATEGY",
          completedAt: new Date(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          result: {
            requestedStrategyKeys,
            symbol,
          },
        });
        this.logger.warn({
          event: "pipeline_no_active_strategy",
          runId,
          userId: job.userId,
          symbol,
          requestedStrategyKeys,
        });
        return;
      }
      let analyses: FusionInput;
      let fusionOutput: FusionOutput;
      let analysisCacheHits: Record<string, boolean> | undefined;
      const preferredTimeframes = this.settings
        ? await this.settings
            .get(job.userId)
            .then((setting) => setting.preferredTimeframes)
            .catch(() => [] as string[])
        : [];
      const timeframeSelection = selectPipelineTimeframes(
        typeof job.params?.interval === 'string' ? job.params.interval : undefined,
        preferredTimeframes,
        typeof definition.defaultParams.interval === 'string'
          ? definition.defaultParams.interval
          : '15m',
      );
      const interval = timeframeSelection.primary;
      const timeframeMarketData = await Promise.all(
        timeframeSelection.selected.map(async (timeframe) => {
          try {
            const [snapshot, candles] = await Promise.all([
              this.marketData.getIndicatorSnapshot(
                job.provider as unknown as ExchangeProvider,
                symbol,
                timeframe as ExchangeInterval,
              ),
              this.marketData.getHistoricalCandles({
                provider: job.provider as unknown as ExchangeProvider,
                symbol,
                interval: timeframe as ExchangeInterval,
                limit: 1,
              }),
            ]);
            return { timeframe, snapshot, candles };
          } catch (error) {
            this.logger.warn({
              event: 'pipeline_timeframe_data_unavailable',
              runId,
              symbol,
              timeframe,
              message: error instanceof Error ? error.message : 'Unknown market-data error',
            });
            return { timeframe, snapshot: undefined, candles: [] };
          }
        }),
      );
      const primaryMarketData = timeframeMarketData.find((item) => item.timeframe === interval)!;
      const indicatorSnapshot = primaryMarketData.snapshot;
      const recentCandles = primaryMarketData.candles;
      const lastPrice = recentCandles[0] ? Number(recentCandles[0].close) : undefined;
      const nowMs = Date.now();
      const staleTimeframes = timeframeMarketData
        .filter((item) => {
          const candle = item.candles[0];
          const candleClose = candle?.closeTime;
          const indicatorClose = item.snapshot?.candleCloseTime;
          const candleTime =
            candleClose instanceof Date
              ? candleClose.getTime()
              : candleClose
                ? new Date(candleClose).getTime()
                : NaN;
          const indicatorTime =
            indicatorClose instanceof Date
              ? indicatorClose.getTime()
              : indicatorClose
                ? new Date(indicatorClose).getTime()
                : NaN;
          const maxAgeMs = timeframeMilliseconds(item.timeframe) * 2;
          return (
            !Number.isFinite(candleTime) ||
            !Number.isFinite(indicatorTime) ||
            nowMs - Number(candleTime) > maxAgeMs ||
            nowMs - Number(indicatorTime) > maxAgeMs
          );
        })
        .map((item) => item.timeframe);
      const staleTimeframeSet = new Set(staleTimeframes);
      const multiTimeframe = analyzeMultiTimeframe(
        interval,
        timeframeMarketData
          .filter((item) => !staleTimeframeSet.has(item.timeframe))
          .map((item) => ({
            timeframe: item.timeframe,
            close: item.candles[0] ? Number(item.candles[0].close) : undefined,
            ema20: Number(item.snapshot?.values.ema20),
            ema50: Number(item.snapshot?.values.ema50),
            rsi: Number(item.snapshot?.values.rsi14),
          })),
      );

      if (staleTimeframeSet.has(interval)) {
        const completedAt = new Date();
        const reason = `STALE_MARKET_DATA:${staleTimeframes.join(',')}`;
        this.logger.warn({
          event: 'pipeline_stale_market_data_rejected',
          runId,
          symbol,
          staleTimeframes,
        });
        await this.repository.updateRun(runId, {
          status: 'COMPLETED',
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          decision: 'WAIT',
          confidence: 0,
          dataQuality: 'INSUFFICIENT',
          timeframe: String(interval),
          skippedReason: reason,
          result: {
            decision: 'WAIT',
            reason,
            actionable: false,
            staleTimeframes,
            multiTimeframe: multiTimeframe as unknown as Prisma.InputJsonValue,
          },
        });
        return;
      }
      if (staleTimeframes.length > 0) {
        this.logger.warn({
          event: 'pipeline_optional_timeframe_data_ignored',
          runId,
          symbol,
          staleTimeframes,
        });
      }

      const signalFilter = this.signalFilter.evaluate({
        price: lastPrice,
        symbol,
        provider: job.provider,
        timeframe: String(interval),
        rsi: Number(indicatorSnapshot?.values.rsi14),
        atr: Number(indicatorSnapshot?.values.atr14),
        volumeChangePercent: Number(indicatorSnapshot?.values.volumeChangePercent),
        ema20: Number(indicatorSnapshot?.values.ema20),
        ema50: Number(indicatorSnapshot?.values.ema50),
        ema200: Number(indicatorSnapshot?.values.ema200),
        adx: Number(indicatorSnapshot?.values.adx14),
        efficiencyRatio: Number(indicatorSnapshot?.values.efficiencyRatio20),
      });
      if (!signalFilter.allowed) {
        this.logger.log({
          event: "pipeline_signal_filter_skip",
          runId,
          symbol,
          reason: signalFilter.reason,
        });
        const completedAt = new Date();
        this.analytics.recordStageTelemetry({
          pipelineId: job.pipelineId,
          runId,
          symbol,
          exchange: String(job.provider),
          timeframe: String(job.params?.interval ?? definition.defaultParams.interval),
          stageName: 'signal-filter',
          inputSummary: `rsi=${Number(indicatorSnapshot?.values.rsi14)}, atr=${Number(indicatorSnapshot?.values.atr14)}`,
          outputSummary: signalFilter.reason ?? 'signal-filter rejected',
          confidence: 0,
          opportunityScore: 0,
          riskScore: 0,
          decision: 'WAIT',
          rejectReason: signalFilter.reason,
          executionResult: 'REJECTED',
          durationMs: completedAt.getTime() - startedAt.getTime(),
          tokenUsage: 0,
          apiCost: 0,
          createdAt: completedAt.toISOString(),
        });
        await this.repository.updateRun(runId, {
          status: "COMPLETED",
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          decision: "WAIT",
          confidence: 0,
          dataQuality: "INSUFFICIENT",
          timeframe: String(interval),
          skippedReason: signalFilter.reason,
        result: {
          decision: "WAIT",
          reason: signalFilter.reason,
          actionable: false,
          signalFilter: { allowed: signalFilter.allowed, reason: signalFilter.reason },
          multiTimeframe: multiTimeframe as unknown as Prisma.InputJsonValue,
        },
        });
        return;
      }
      const existing = job.useStoredContext
        ? await this.repository.findRun(runId)
        : undefined;
      const stored = existing?.storedContext as {
        analyses?: FusionInput;
        fusionOutput?: FusionOutput;
      } | null;
      if (stored?.analyses && stored.fusionOutput) {
        analyses = stored.analyses;
        fusionOutput = stored.fusionOutput;
        for (const step of definition.steps.filter(
          (item) => item.type !== "DECISION",
        ))
          await this.completeStep(
            runId,
            step.id,
            step.type,
            step.id === "fusion"
              ? fusionOutput
              : analyses[step.id as keyof FusionInput],
          );
      } else {
        for (const step of definition.steps.filter(
          (item) => item.type === "AGENT",
        ))
          await this.startStep(runId, step.id);
        await this.startStep(runId, "fusion");
        const pipelineInput = FusionRunInputSchema.parse({
          symbol,
          provider: job.provider,
          ...definition.defaultParams,
          ...analysisParams(job.params),
        });
        const result = await this.withTimeout(
          this.fusion.runDetailed({
            input: pipelineInput,
            userId: job.userId,
            invocationSource: this.source(job.trigger),
            correlationId: runId,
          }),
          definition.timeoutMs,
        );
        analyses = result.analyses;
        fusionOutput = result.fusionOutput;
        analysisCacheHits = result.cacheHits;
        const completedAt = new Date();
        for (const step of definition.steps.filter(
          (item) => item.type === "AGENT",
        ))
          await this.finishStep(
            runId,
            step.id,
            analyses[step.id as keyof FusionInput],
            completedAt,
          );
        await this.finishStep(runId, "fusion", fusionOutput, completedAt);
      }
      await this.assertNotCancelled(runId);
      await this.startStep(runId, "decision");
      const synthesizedOutput = await this.decision.decideForUser({
        symbol,
        fusionOutput,
        ...analyses,
      }, job.userId, {
        pipelineRunId: runId,
        provider: job.provider,
        timeframe: String(interval),
        referencePrice: lastPrice,
      });
      // Existing short-timeframe schedules that already opted into breakout
      // automatically participate in the bounded momentum scalp candidate.
      if (
        timeframeMilliseconds(String(interval)) <= 15 * 60_000 &&
        eligibleStrategyKeys.includes("breakout") &&
        !eligibleStrategyKeys.includes("momentum-scalp")
      ) eligibleStrategyKeys.push("momentum-scalp");
      const strategySelection = selectStrategyDecision(
        eligibleStrategyKeys,
        synthesizedOutput,
        analyses,
        {
          timeframe: String(interval),
          priceChangePercent: Number(indicatorSnapshot?.values.priceChangePercent),
          volumeChangePercent: Number(indicatorSnapshot?.values.volumeChangePercent),
          adx: Number(indicatorSnapshot?.values.adx14),
          efficiencyRatio: Number(indicatorSnapshot?.values.efficiencyRatio20),
          ema20: Number(indicatorSnapshot?.values.ema20),
          ema50: Number(indicatorSnapshot?.values.ema50),
        },
      );
      const primaryRsi = multiTimeframe.frames.find(
        (frame) => frame.timeframe === String(interval),
      )?.rsi;
      const marketDislocation = job.trigger === "EVENT"
        ? marketDislocationFromParams(job.params?.eventScan)
        : undefined;
      const rankedCandidates = rankStrategyDecisionCandidates(
        eligibleStrategyKeys,
        synthesizedOutput,
        analyses,
        {
          timeframe: String(interval),
          priceChangePercent: Number(indicatorSnapshot?.values.priceChangePercent),
          volumeChangePercent: Number(indicatorSnapshot?.values.volumeChangePercent),
          adx: Number(indicatorSnapshot?.values.adx14),
          efficiencyRatio: Number(indicatorSnapshot?.values.efficiencyRatio20),
          ema20: Number(indicatorSnapshot?.values.ema20),
          ema50: Number(indicatorSnapshot?.values.ema50),
        },
      );
      const gateAttempts: Array<{
        strategyKey: string;
        decision: string;
        score: number;
        actionable: boolean;
        blockedReasons: string[];
        advisoryReasons: string[];
      }> = [];
      let selectedGate: {
        strategyKey: string;
        output: Awaited<ReturnType<DecisionService["calibrateForExecution"]>>;
        filter: ReturnType<DecisionRiskPolicyService["evaluate"]>;
        judge: ReturnType<DecisionJudgeService["evaluate"]>;
        multiTimeframeFilter: ReturnType<typeof evaluateMultiTimeframeDecision>;
        quant: Awaited<ReturnType<QuantExecutionPolicyService["evaluate"]>>;
        actionable: boolean;
        dislocationCanary: boolean;
        blockedReasons: string[];
        advisoryReasons: string[];
      } | undefined;
      for (const candidate of rankedCandidates) {
        const calibrated = await this.decision.calibrateForExecution(
          candidate.decision,
          job.userId,
          {
            symbol,
            strategyKey: candidate.strategyKey,
            provider: job.provider,
            timeframe: String(interval),
          },
        );
        const policyContext = { symbol, provider: job.provider, timeframe: String(interval), regime: calibrated.regime.type };
        const candidateFilter = this.riskPolicy.evaluate(calibrated, policyContext);
        const candidateJudge = this.judge?.evaluate(calibrated, analyses, {
          symbol,
          provider: job.provider,
          timeframe: String(interval),
          referencePrice: lastPrice,
          sourceTimestamp: indicatorSnapshot?.candleCloseTime ?? recentCandles[0]?.closeTime,
          requireCalibratedConfidence: true,
        }) ?? { verdict: 'APPROVE' as const, approved: true, reasons: [] };
        const candidateMultiTimeframe = evaluateMultiTimeframeDecision(calibrated.decision, multiTimeframe);
        const candidateQuant = this.quantPolicy
          ? await this.quantPolicy.evaluate({
              userId: job.userId,
              symbol,
              provider: job.provider,
              timeframe: String(interval),
              strategyKey: candidate.strategyKey,
              mode: process.env.TRADING_MODE === "LIVE" ? "LIVE" : "DEMO",
              decision: calibrated,
              multiTimeframeConfirmation: candidateMultiTimeframe.confirmation,
              primaryRsi,
              marketEventImpact: analyses.news.impact.level,
              marketEventDirection: analyses.news.impact.direction,
              marketDislocation,
            }).catch((error: unknown) => {
              this.logger.error({
                event: "quant_execution_policy_failed",
                runId,
                symbol,
                strategyKey: candidate.strategyKey,
                message: error instanceof Error ? error.message : "Unknown quant policy error",
              });
              return { allowed: false as const, reason: "QUANT_POLICY_UNAVAILABLE" as const };
            })
          : { allowed: false as const, reason: "QUANT_VALIDATION_MISSING" as const };
        const candidateBlockedReasons = [
          candidateFilter.reason,
          ...candidateJudge.reasons,
          candidateQuant.allowed ? undefined : candidateQuant.reason,
          candidateMultiTimeframe.allowed ? undefined : candidateMultiTimeframe.reason,
        ].filter((item): item is string => Boolean(item));
        const standardActionable = candidateFilter.actionable && candidateJudge.approved &&
          candidateQuant.allowed && candidateQuant.dislocationCanary !== true &&
          candidateMultiTimeframe.allowed;
        const filterCanaryCompatible = candidateFilter.actionable ||
          (typeof candidateFilter.reason === "string" &&
            DISLOCATION_CANARY_ADVISORY_REASONS.has(candidateFilter.reason));
        const judgeCanaryCompatible = candidateJudge.approved ||
          (candidateJudge.reasons.length > 0 &&
            historicalGateReasonsAreAdvisory(candidateJudge.reasons));
        const dislocationCanary = !standardActionable &&
          candidateQuant.allowed &&
          candidateQuant.dislocationCanary === true &&
          candidateMultiTimeframe.allowed &&
          filterCanaryCompatible &&
          judgeCanaryCompatible &&
          historicalGateReasonsAreAdvisory(candidateBlockedReasons);
        const candidateActionable = standardActionable || dislocationCanary;
        const advisoryReasons = dislocationCanary
          ? [...new Set([
              ...candidateBlockedReasons,
              ...(candidateQuant.reason ? [candidateQuant.reason] : []),
            ])]
          : [];
        const evaluated = {
          strategyKey: candidate.strategyKey,
          output: calibrated,
          filter: candidateFilter,
          judge: candidateJudge,
          multiTimeframeFilter: candidateMultiTimeframe,
          quant: candidateQuant,
          actionable: candidateActionable,
          dislocationCanary,
          blockedReasons: dislocationCanary ? [] : candidateBlockedReasons,
          advisoryReasons,
        };
        gateAttempts.push({
          strategyKey: candidate.strategyKey,
          decision: calibrated.decision,
          score: candidate.score,
          actionable: candidateActionable,
          blockedReasons: [...new Set(evaluated.blockedReasons)],
          advisoryReasons,
        });
        selectedGate ??= evaluated;
        if (candidateActionable) {
          selectedGate = evaluated;
          break;
        }
      }
      if (!selectedGate) throw new Error("NO_STRATEGY_CANDIDATE");
      const {
        strategyKey,
        output,
        filter,
        judge,
        multiTimeframeFilter,
        quant,
        actionable,
        dislocationCanary,
        blockedReasons: selectedBlockedReasons,
        advisoryReasons: selectedAdvisoryReasons,
      } = selectedGate;
      const executionStrategySelection = {
        ...strategySelection,
        initialSelectedStrategyKey: strategySelection.selectedStrategyKey,
        selectedStrategyKey: strategyKey,
        decision: output,
        gateAttempts,
      };
      const decisionCompletedAt = new Date();
      const sourceTimestamp = indicatorSnapshot?.candleCloseTime ??
        recentCandles[0]?.closeTime;
      const sourceDataAgeMs = sourceTimestamp
        ? Math.max(0, decisionCompletedAt.getTime() - new Date(sourceTimestamp).getTime())
        : undefined;
      const quantBlockReason = quant.allowed ? undefined : quant.reason;
      const reason = filter.reason ?? judge.reasons[0] ?? quantBlockReason ?? multiTimeframeFilter.reason;
      const candidateDecision = {
        decision: output.decision,
        confidence: output.confidence,
        strategyKey,
        provider: job.provider,
        timeframe: String(interval),
        marketRegime: output.regime.type,
        actionable,
        dislocationCanary,
        blockedReasons: [...new Set(selectedBlockedReasons)],
        advisoryReasons: [...new Set([
          ...selectedAdvisoryReasons,
          ...('advisory' in quant && quant.advisory && quant.reason ? [quant.reason] : []),
        ])],
      };
      await this.finishStep(runId, "decision", output, decisionCompletedAt);
      this.analytics.recordStageTelemetry({
        pipelineId: job.pipelineId,
        runId,
        symbol,
        exchange: String(job.provider),
        timeframe: String(job.params?.interval ?? definition.defaultParams.interval),
        stageName: 'decision',
        inputSummary: `regime=${output.regime.type}; conflict=${output.conflictLevel}; strategies=${eligibleStrategyKeys.join(',')}`,
        outputSummary: `${output.decision}; strategy=${strategyKey}; confidence=${output.confidence}; ev=${output.expectedValue}`,
        confidence: output.confidence,
        opportunityScore: output.opportunityScore,
        riskScore: output.riskScore,
        decision: output.decision,
        rejectReason: reason,
        executionResult: actionable ? 'APPROVED' : 'REJECTED',
        durationMs: decisionCompletedAt.getTime() - startedAt.getTime(),
        tokenUsage: 0,
        apiCost: 0,
        cacheHits: analysisCacheHits,
        sourceDataAgeMs,
        createdAt: decisionCompletedAt.toISOString(),
      });
      const executionDecision = actionable
        ? output
        : { ...output, decision: "WAIT" as const };
      const volatilityAtr = preferredTradePlanAtr(
        indicatorSnapshot?.values.atr14,
        analyses.market?.volatility.atr,
      );
      const primaryCandle = recentCandles[0];
      const volumeRatio = Number.isFinite(Number(indicatorSnapshot?.values.volumeChangePercent))
        ? 1 + Number(indicatorSnapshot?.values.volumeChangePercent) / 100
        : undefined;
      let riskAssessment: Awaited<ReturnType<LiveTradingService["assessPipelineDecision"]>> | undefined;
      let liveExecution: Awaited<ReturnType<LiveTradingService["executePipeline"]>> | undefined;
      let submissionStartedAt: Date | undefined;
      let executionGateReason: string | undefined;
      let canaryCooldownKey: string | undefined;
      let retainCanaryCooldown = false;
      if (actionable && job.confluenceBatchId && this.confluenceCollector) {
        const candidateScore = computeMultiFactorCompositeScore({
          confidence: output.confidence,
          opportunityScore: output.opportunityScore,
          expectedValue: output.expectedValue,
          riskScore: output.riskScore,
        });
        const confluenceSignal: ConfluenceSignal = {
          pipelineRunId: runId,
          symbol,
          decision: output.decision as "LONG" | "SHORT",
          confidence: output.confidence,
          opportunityScore: output.opportunityScore,
          expectedValue: output.expectedValue,
          riskScore: output.riskScore,
          strategyKey,
          compositeScore: candidateScore,
          regime: output.regime.type,
          volatilityAtr,
          referencePrice: Number(lastPrice),
          executionContext: {
            executionDecision,
            strategyKey:
              strategyKey === "momentum-scalp" ? "breakout" : strategyKey,
            provider: String(job.provider),
            interval: String(interval),
            quant,
            tradePlanContext: {
              timeframeMs: timeframeMilliseconds(String(interval)),
              ...(Number.isFinite(Number(indicatorSnapshot?.values.rsi14))
                ? { rsi: Number(indicatorSnapshot?.values.rsi14) }
                : {}),
              ...(Number.isFinite(Number(indicatorSnapshot?.values.rollingLow))
                ? { support: Number(indicatorSnapshot?.values.rollingLow) }
                : {}),
              ...(Number.isFinite(Number(indicatorSnapshot?.values.rollingHigh))
                ? { resistance: Number(indicatorSnapshot?.values.rollingHigh) }
                : {}),
              ...(Number.isFinite(Number(indicatorSnapshot?.values.adx14))
                ? { adx: Number(indicatorSnapshot?.values.adx14) }
                : {}),
              ...(Number.isFinite(
                Number(indicatorSnapshot?.values.efficiencyRatio20),
              )
                ? {
                    efficiencyRatio: Number(
                      indicatorSnapshot?.values.efficiencyRatio20,
                    ),
                  }
                : {}),
              ...(Number.isFinite(Number(indicatorSnapshot?.values.ema20))
                ? { ema20: Number(indicatorSnapshot?.values.ema20) }
                : {}),
              ...(Number.isFinite(Number(indicatorSnapshot?.values.ema50))
                ? { ema50: Number(indicatorSnapshot?.values.ema50) }
                : {}),
              ...(analyses.technical?.structure.breakout !== undefined
                ? { breakout: analyses.technical.structure.breakout }
                : {}),
              ...(analyses.technical?.structure.marketStructure
                ? {
                    marketStructure:
                      analyses.technical.structure.marketStructure,
                  }
                : {}),
              ...(primaryCandle && Number.isFinite(Number(primaryCandle.open))
                ? { candleOpen: Number(primaryCandle.open) }
                : {}),
              ...(primaryCandle && Number.isFinite(Number(primaryCandle.high))
                ? { candleHigh: Number(primaryCandle.high) }
                : {}),
              ...(primaryCandle && Number.isFinite(Number(primaryCandle.low))
                ? { candleLow: Number(primaryCandle.low) }
                : {}),
              ...(primaryCandle && Number.isFinite(Number(primaryCandle.close))
                ? { candleClose: Number(primaryCandle.close) }
                : {}),
              ...(volumeRatio !== undefined ? { volumeRatio } : {}),
            },
          },
        };
        const report = await this.confluenceCollector.addSignal(
          job.confluenceBatchId,
          confluenceSignal,
        );
        if (report.ready) {
          await this.executeConfluenceBatch(job.confluenceBatchId, job.userId);
        }
      } else if (actionable) {
        // ─── Distributed Execution Lock ───────────────────────────────────────
        // Prevent race condition: multiple concurrent pipelines for the same user
        // could all read the same balance snapshot and collectively over-leverage.
        // We acquire a per-user Redis mutex (NX = only set if not exists) that
        // ensures only ONE pipeline at a time can run assess+execute for a user.
        const lockKey = `pipeline:exec:lock:${job.userId}`;
        const lockTtl = 30; // seconds — generous enough for one assess+execute round
        const acquired = await this.redis.setNx(lockKey, runId, lockTtl);

        if (!acquired) {
          // Preserve the approved candidate and let BullMQ retry after its
          // configured backoff. Completing the run here would silently discard
          // a valid signal merely because another symbol acquired the mutex first.
          this.logger.warn({
            event: 'pipeline_execution_lock_busy',
            userId: job.userId,
            runId,
            symbol,
          });
          throw new PipelineExecutionLockBusyError('EXECUTION_LOCK_BUSY');
        }

        try {
          if (dislocationCanary) {
            const cooldownKey =
              `pipeline:dislocation-canary:cooldown:${job.userId}:${symbol}:${output.decision}`;
            const canaryReserved = await this.redis.setNx(
              cooldownKey,
              runId,
              60 * 60,
            );
            if (canaryReserved) canaryCooldownKey = cooldownKey;
            else executionGateReason = "DISLOCATION_CANARY_COOLDOWN_ACTIVE";
          }
          if (!executionGateReason) {
            const assess = async () => {
              riskAssessment = await this.liveTrading.assessPipelineDecision({
                userId: job.userId,
                pipelineRunId: runId,
                symbol,
                provider: job.provider as unknown as ExchangeProvider,
                decision: executionDecision,
                // Momentum scalp currently shares the governed breakout portfolio
                // bucket while retaining its own decision/quant identity.
                strategyKey: strategyKey === "momentum-scalp" ? "breakout" : strategyKey,
                executionSizeFactor:
                  'advisory' in quant && quant.advisory && 'sizeFactor' in quant
                    ? quant.sizeFactor
                    : undefined,
                ...(volatilityAtr !== undefined
                  ? { volatilityAtr }
                  : {}),
                tradePlanContext: {
                  timeframeMs: timeframeMilliseconds(String(interval)),
                  ...(Number.isFinite(Number(indicatorSnapshot?.values.rsi14))
                    ? { rsi: Number(indicatorSnapshot?.values.rsi14) }
                    : {}),
                  ...(Number.isFinite(Number(indicatorSnapshot?.values.rollingLow))
                    ? { support: Number(indicatorSnapshot?.values.rollingLow) }
                    : {}),
                  ...(Number.isFinite(Number(indicatorSnapshot?.values.rollingHigh))
                    ? { resistance: Number(indicatorSnapshot?.values.rollingHigh) }
                    : {}),
                  ...(Number.isFinite(Number(indicatorSnapshot?.values.adx14))
                    ? { adx: Number(indicatorSnapshot?.values.adx14) }
                    : {}),
                  ...(Number.isFinite(Number(indicatorSnapshot?.values.efficiencyRatio20))
                    ? { efficiencyRatio: Number(indicatorSnapshot?.values.efficiencyRatio20) }
                    : {}),
                  ...(Number.isFinite(Number(indicatorSnapshot?.values.ema20))
                    ? { ema20: Number(indicatorSnapshot?.values.ema20) }
                    : {}),
                  ...(Number.isFinite(Number(indicatorSnapshot?.values.ema50))
                    ? { ema50: Number(indicatorSnapshot?.values.ema50) }
                    : {}),
                  ...(analyses.technical?.structure.breakout !== undefined
                    ? { breakout: analyses.technical.structure.breakout }
                    : {}),
                  ...(analyses.technical?.structure.marketStructure
                    ? { marketStructure: analyses.technical.structure.marketStructure }
                    : {}),
                  ...(primaryCandle && Number.isFinite(Number(primaryCandle.open))
                    ? { candleOpen: Number(primaryCandle.open) }
                    : {}),
                  ...(primaryCandle && Number.isFinite(Number(primaryCandle.high))
                    ? { candleHigh: Number(primaryCandle.high) }
                    : {}),
                  ...(primaryCandle && Number.isFinite(Number(primaryCandle.low))
                    ? { candleLow: Number(primaryCandle.low) }
                    : {}),
                  ...(primaryCandle && Number.isFinite(Number(primaryCandle.close))
                    ? { candleClose: Number(primaryCandle.close) }
                    : {}),
                  ...(volumeRatio !== undefined ? { volumeRatio } : {}),
                },
              });
              if (riskAssessment.outcome === "NO_ELIGIBLE_EXCHANGE_CONNECTION") {
                throw new Error("NO_ELIGIBLE_EXCHANGE_CONNECTION: Active verified exchange connection is required to run live risk assessment.");
              }
            };

            const execute = async () => {
              if (riskAssessment?.outcome === "RISK_APPROVED") {
                submissionStartedAt = new Date();
                const execution = await this.liveTrading.executePipeline(
                  job.userId,
                  runId,
                );
                liveExecution = execution;
                return execution;
              }
              return { outcome: riskAssessment?.outcome ?? "SKIPPED" };
            };

            const finalExecution = await executeWithSingleDriftReassessment({
              assess,
              execute,
            });
            retainCanaryCooldown = dislocationCanary &&
              finalExecution.outcome === "ORDER_SUBMITTED";

            if (finalExecution.outcome === "EXECUTION_FAILED" && finalExecution.retryable === true) {
              throw new PipelineExecutionRetryableError(
                finalExecution.errorCode ?? "RETRYABLE_EXCHANGE_FAILURE",
              );
            }
          }
        } finally {
          if (canaryCooldownKey && !retainCanaryCooldown) {
            await this.redis.compareAndDelete(canaryCooldownKey, runId);
          }
          // Always release the lock — even if assessment or execution throws
          await this.redis.compareAndDelete(lockKey, runId);
        }
      } else if (!actionable && job.confluenceBatchId && this.confluenceCollector) {
        const report = await this.confluenceCollector.reportNonActionable(
          job.confluenceBatchId,
        );
        if (report.ready) {
          await this.executeConfluenceBatch(job.confluenceBatchId, job.userId);
        }
      }
      const completedAt = new Date();
      const risk = riskAssessment?.risk;
      const riskApproved = Boolean(risk?.approved);
      const orderSubmitted = liveExecution?.outcome === "ORDER_SUBMITTED";
      const submittedOrder = orderSubmitted && liveExecution && "order" in liveExecution
        ? liveExecution.order
        : undefined;
      const actualPrice = submittedOrder?.status === "FILLED" && submittedOrder.price
        ? Number(submittedOrder.price)
        : undefined;
      const referencePrice = Number(lastPrice);
      const slippageBps = actualPrice && referencePrice > 0
        ? Math.abs(actualPrice - referencePrice) / referencePrice * 10_000
        : undefined;
      const finalActionable = actionable && !executionGateReason;
      const finalExecutionDecision = finalActionable
        ? executionDecision
        : { ...executionDecision, decision: "WAIT" as const };
      const finalCandidateDecision = executionGateReason
        ? {
            ...candidateDecision,
            actionable: false,
            blockedReasons: [...new Set([
              ...candidateDecision.blockedReasons,
              executionGateReason,
            ])],
          }
        : candidateDecision;
      const finalSkippedReason = executionGateReason ?? (!actionable
        ? reason
        : !riskApproved
          ? risk?.reason ?? riskAssessment?.outcome ?? "RISK_NOT_APPROVED"
          : !orderSubmitted
            ? liveExecution?.errorCode ?? liveExecution?.outcome ?? "ORDER_NOT_SUBMITTED"
            : undefined);
      this.analytics.recordStageTelemetry({
        pipelineId: job.pipelineId,
        runId,
        symbol,
        exchange: String(job.provider),
        timeframe: String(job.params?.interval ?? definition.defaultParams.interval),
        stageName: 'execution',
        inputSummary: `decision=${finalExecutionDecision.decision}; confidence=${output.confidence}`,
        outputSummary: `risk=${risk?.reason ?? 'approved'}; live=${liveExecution?.outcome ?? 'unknown'}`,
        confidence: output.confidence,
        opportunityScore: output.opportunityScore,
        riskScore: risk?.riskScore ?? 0,
        decision: finalExecutionDecision.decision,
        rejectReason: finalSkippedReason,
        executionResult: orderSubmitted ? 'EXECUTED' : riskApproved ? 'RISK_APPROVED' : 'REJECTED',
        durationMs: completedAt.getTime() - startedAt.getTime(),
        tokenUsage: 0,
        apiCost: 0,
        sourceDataAgeMs,
        decisionToExecutionMs: completedAt.getTime() - decisionCompletedAt.getTime(),
        submissionLatencyMs: submissionStartedAt
          ? completedAt.getTime() - submissionStartedAt.getTime()
          : undefined,
        slippageBps,
        createdAt: completedAt.toISOString(),
      });
      await this.repository.updateRun(runId, {
        status: "COMPLETED",
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        decision: finalExecutionDecision.decision,
        confidence: output.confidence,
        dataQuality: output.dataQuality,
        marketRegime: output.regime.type,
        configurationVersion: output.learningConfiguration?.version,
        learningStage: output.learningConfiguration?.stage,
        timeframe: String(interval),
        skippedReason: finalSkippedReason,
        storedContext: { analyses, fusionOutput, candidateDecision: finalCandidateDecision, strategySelection: executionStrategySelection as unknown as Prisma.InputJsonValue, multiTimeframe: multiTimeframe as unknown as Prisma.InputJsonValue, quant: quant as unknown as Prisma.InputJsonValue },
        result: {
          ...output,
          candidateDecision: finalCandidateDecision,
          selectedStrategyKey: strategyKey,
          strategySelection: executionStrategySelection as unknown as Prisma.InputJsonValue,
          actionable: finalActionable,
          skippedReason: finalSkippedReason,
          signalFilter: {
            allowed: signalFilter.allowed,
            preliminaryRegime: signalFilter.preliminaryRegime,
          },
          multiTimeframe: {
            ...multiTimeframe,
            decisionConfirmation: multiTimeframeFilter.confirmation,
            allowed: multiTimeframeFilter.allowed,
            reason: multiTimeframeFilter.reason,
          },
          riskAssessment,
          liveExecution,
          judge: judge as unknown as Prisma.InputJsonValue,
          quant: quant as unknown as Prisma.InputJsonValue,
        },
      });
      await this.alerts.contextual(runId, symbol, analyses);
      if (!finalActionable) {
        await this.alerts.blockedOpportunity({
          runId,
          userId: job.userId,
          symbol,
          decision: finalCandidateDecision.decision,
          confidence: finalCandidateDecision.confidence,
          blockedReasons: finalCandidateDecision.blockedReasons,
          analyses,
          multiTimeframeConfirmation: multiTimeframeFilter.confirmation,
          priceChangePercent: Number.isFinite(Number(indicatorSnapshot?.values.priceChangePercent))
            ? Number(indicatorSnapshot?.values.priceChangePercent)
            : undefined,
        }).catch((error: unknown) => this.logger.warn({
          event: 'pipeline_blocked_opportunity_alert_failed',
          runId,
          symbol,
          message: error instanceof Error ? error.message : String(error),
        }));
      }
      if (finalActionable && riskApproved)
        await this.alerts.decision(runId, symbol, output);
    } catch (error) {
      const completedAt = new Date();
      const cancelled = error instanceof PipelineCancelledError;
      const executionLockBusy = error instanceof PipelineExecutionLockBusyError;
      const executionRetryable = error instanceof PipelineExecutionRetryableError;
      const timedOut =
        error instanceof Error && error.message === "PIPELINE_TIMEOUT";
      const isNoConnection =
        error instanceof Error && error.message.includes("NO_ELIGIBLE_EXCHANGE_CONNECTION");
      await this.repository.updateRun(runId, {
        status: cancelled ? "CANCELLED" : executionLockBusy ? "QUEUED" : timedOut ? "TIMEOUT" : "FAILED",
        completedAt: executionLockBusy ? null : completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        errorCode: cancelled
          ? "CANCELLED_BY_USER"
          : executionLockBusy
            ? "EXECUTION_LOCK_BUSY"
          : timedOut
            ? "PIPELINE_TIMEOUT"
            : isNoConnection
              ? "NO_ELIGIBLE_EXCHANGE_CONNECTION"
              : executionRetryable
                ? "RETRYABLE_EXCHANGE_FAILURE"
                : "PIPELINE_EXECUTION_FAILED",
        safeErrorMessage:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Pipeline execution failed",
      });
      if (cancelled) return;
      if (!executionLockBusy && !executionRetryable) await this.alerts.repeatedFailure(runId, symbol);
      throw error;
    }
  }

  private source(trigger: PipelineJob["trigger"]): AgentInvocationSource {
    return trigger === "SCHEDULE"
      ? AgentInvocationSource.FUTURE_SCHEDULED
      : trigger === "EVENT"
        ? AgentInvocationSource.FUTURE_EVENT_DRIVEN
        : trigger === "REPLAY"
          ? AgentInvocationSource.REPLAY
          : AgentInvocationSource.INTERNAL_SERVICE;
  }
  private async assertNotCancelled(runId: string) {
    if (await this.cancellation.isCancelled(runId))
      throw new PipelineCancelledError("Pipeline cancelled");
  }
  private startStep(runId: string, stepId: string) {
    return this.repository.updateStep(runId, stepId, {
      status: "RUNNING",
      startedAt: new Date(),
    });
  }
  private finishStep(
    runId: string,
    stepId: string,
    output: unknown,
    completedAt: Date,
  ) {
    return this.repository.updateStep(runId, stepId, {
      status: "COMPLETED",
      completedAt,
      outputRef: output as Prisma.InputJsonValue,
    });
  }
  private async completeStep(
    runId: string,
    stepId: string,
    _type: string,
    output: unknown,
  ) {
    const now = new Date();
    await this.repository.updateStep(runId, stepId, {
      status: "COMPLETED",
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      outputRef: output as Prisma.InputJsonValue,
    });
  }
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("PIPELINE_TIMEOUT")),
        timeoutMs,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(
            error instanceof Error
              ? error
              : new Error("Pipeline operation failed"),
          );
        },
      );
    });
  }

  /**
   * Evaluates a completed confluence batch, executes the selected best candidate,
   * boosts sizing, and shadow logs rejected signals.
   */
  async executeConfluenceBatch(
    batchId: string,
    userId: string,
  ): Promise<void> {
    if (!this.confluenceCollector) return;

    const batch = await this.confluenceCollector.drainBatch(batchId);
    if (!batch || batch.signals.length === 0) {
      return;
    }

    const config = this.getConfluenceConfig();
    const evaluation = evaluateConfluence(
      batch.signals,
      batch.meta.expectedCount,
      config,
    );

    if (!evaluation) return;

    const selected = evaluation.selected;
    const lockKey = `pipeline:exec:lock:${userId}`;
    const lockTtl = 30;
    const acquired = await this.redis.setNx(lockKey, selected.pipelineRunId, lockTtl);

    if (!acquired) {
      this.logger.warn({
        event: "confluence_execution_lock_busy",
        userId,
        batchId,
        selectedRunId: selected.pipelineRunId,
        symbol: selected.symbol,
      });
      throw new PipelineExecutionLockBusyError("EXECUTION_LOCK_BUSY");
    }

    try {
      let riskAssessment: Awaited<ReturnType<LiveTradingService["assessPipelineDecision"]>> | undefined;

      const assess = async () => {
        riskAssessment = await this.liveTrading.assessPipelineDecision({
          userId,
          pipelineRunId: selected.pipelineRunId,
          symbol: selected.symbol,
          provider: selected.executionContext.provider as unknown as ExchangeProvider,
          decision: selected.executionContext.executionDecision as DecisionOutput,
          strategyKey: selected.executionContext.strategyKey,
          executionSizeFactor: evaluation.sizeFactor,
          ...(selected.volatilityAtr !== undefined ? { volatilityAtr: selected.volatilityAtr } : {}),
          tradePlanContext: selected.executionContext.tradePlanContext as TradePlanMarketContext,
        });
        if (riskAssessment.outcome === "NO_ELIGIBLE_EXCHANGE_CONNECTION") {
          throw new Error(
            "NO_ELIGIBLE_EXCHANGE_CONNECTION: Active verified exchange connection is required to run live risk assessment.",
          );
        }
      };

      const execute = async () => {
        if (riskAssessment?.outcome === "RISK_APPROVED") {
          return this.liveTrading.executePipeline(
            userId,
            selected.pipelineRunId,
          );
        }
        return { outcome: riskAssessment?.outcome ?? "SKIPPED" };
      };

      await executeWithSingleDriftReassessment({
        assess,
        execute,
      });

      if (this.alerts) {
        this.alerts.confluenceEvaluation({
          batchId,
          userId,
          selectedSymbol: selected.symbol,
          selectedScore: selected.compositeScore,
          concordanceCount: evaluation.concordanceCount,
          totalSymbols: evaluation.totalSymbols,
          sizeFactor: evaluation.sizeFactor,
          rejectedSymbols: evaluation.rejected.map((s) => s.symbol),
        });
      }
    } finally {
      await this.redis.compareAndDelete(lockKey, selected.pipelineRunId);
    }

    await this.shadowLogRejectedSignals(userId, evaluation);
  }

  private async shadowLogRejectedSignals(
    userId: string,
    evaluation: ConfluenceEvaluation,
  ): Promise<void> {
    if (evaluation.rejected.length === 0) return;

    const records = evaluation.rejected.map((signal: ConfluenceSignal) => ({
      id: randomUUID(),
      userId,
      pipelineRunId: signal.pipelineRunId,
      symbol: signal.symbol,
      provider: signal.executionContext.provider as unknown as ExchangeProvider,
      decision: signal.decision,
      confidence: signal.confidence,
      mode: "CONFLUENCE_REJECTED",
      referencePrice: signal.referencePrice,
      outcome: "PENDING",
      marketRegime: signal.regime,
    }));

    await this.repository.createPaperSignals(records).catch((err) => {
      this.logger.error({
        event: "confluence_shadow_log_failed",
        error: err instanceof Error ? err.message : String(err),
      });
    });

    for (const signal of evaluation.rejected) {
      await this.repository
        .updateRun(signal.pipelineRunId, {
          skippedReason: "CONFLUENCE_NOT_SELECTED",
        })
        .catch((err) => {
          this.logger.warn({
            event: "confluence_update_rejected_run_failed",
            pipelineRunId: signal.pipelineRunId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
  }

  private getConfluenceConfig(): ConfluenceSizeConfig {
    const boostPerSignal = Number(
      process.env.CONFLUENCE_SIZE_BOOST_PER_SIGNAL ??
        DEFAULT_CONFLUENCE_SIZE_CONFIG.boostPerSignal,
    );
    const maxSizeFactor = Number(
      process.env.CONFLUENCE_MAX_SIZE_FACTOR ??
        DEFAULT_CONFLUENCE_SIZE_CONFIG.maxSizeFactor,
    );
    const minSignalsForBoost = Number(
      process.env.CONFLUENCE_MIN_SIGNALS_FOR_BOOST ??
        DEFAULT_CONFLUENCE_SIZE_CONFIG.minSignalsForBoost,
    );

    return {
      boostPerSignal: Number.isFinite(boostPerSignal)
        ? boostPerSignal
        : DEFAULT_CONFLUENCE_SIZE_CONFIG.boostPerSignal,
      maxSizeFactor: Number.isFinite(maxSizeFactor)
        ? maxSizeFactor
        : DEFAULT_CONFLUENCE_SIZE_CONFIG.maxSizeFactor,
      minSignalsForBoost: Number.isFinite(minSignalsForBoost)
        ? minSignalsForBoost
        : DEFAULT_CONFLUENCE_SIZE_CONFIG.minSignalsForBoost,
    };
  }
}
