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

class PipelineCancelledError extends Error {}
class PipelineExecutionLockBusyError extends Error {}
class PipelineExecutionRetryableError extends Error {}

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
          const candleTime = candle?.closeTime?.getTime();
          const indicatorTime = item.snapshot?.candleCloseTime?.getTime();
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
      }> = [];
      let selectedGate: {
        strategyKey: string;
        output: Awaited<ReturnType<DecisionService["calibrateForExecution"]>>;
        filter: ReturnType<DecisionRiskPolicyService["evaluate"]>;
        judge: ReturnType<DecisionJudgeService["evaluate"]>;
        multiTimeframeFilter: ReturnType<typeof evaluateMultiTimeframeDecision>;
        quant: Awaited<ReturnType<QuantExecutionPolicyService["evaluate"]>>;
        actionable: boolean;
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
              decision: calibrated,
              multiTimeframeConfirmation: candidateMultiTimeframe.confirmation,
              primaryRsi,
              marketEventImpact: analyses.news.impact.level,
              marketEventDirection: analyses.news.impact.direction,
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
        const candidateActionable = candidateFilter.actionable && candidateJudge.approved &&
          candidateQuant.allowed && candidateMultiTimeframe.allowed;
        const candidateBlockedReasons = [
          candidateFilter.reason,
          ...candidateJudge.reasons,
          candidateQuant.allowed ? undefined : candidateQuant.reason,
          candidateMultiTimeframe.allowed ? undefined : candidateMultiTimeframe.reason,
        ].filter((item): item is string => Boolean(item));
        const evaluated = {
          strategyKey: candidate.strategyKey,
          output: calibrated,
          filter: candidateFilter,
          judge: candidateJudge,
          multiTimeframeFilter: candidateMultiTimeframe,
          quant: candidateQuant,
          actionable: candidateActionable,
        };
        gateAttempts.push({
          strategyKey: candidate.strategyKey,
          decision: calibrated.decision,
          score: candidate.score,
          actionable: candidateActionable,
          blockedReasons: [...new Set(candidateBlockedReasons)],
        });
        selectedGate ??= evaluated;
        if (candidateActionable) {
          selectedGate = evaluated;
          break;
        }
      }
      if (!selectedGate) throw new Error("NO_STRATEGY_CANDIDATE");
      const { strategyKey, output, filter, judge, multiTimeframeFilter, quant, actionable } = selectedGate;
      const executionStrategySelection = {
        ...strategySelection,
        initialSelectedStrategyKey: strategySelection.selectedStrategyKey,
        selectedStrategyKey: strategyKey,
        decision: output,
        gateAttempts,
      };
      const decisionCompletedAt = new Date();
      const quantBlockReason = quant.allowed ? undefined : quant.reason;
      const reason = filter.reason ?? judge.reasons[0] ?? quantBlockReason ?? multiTimeframeFilter.reason;
      const blockedReasons = [
        filter.reason,
        ...judge.reasons,
        quantBlockReason,
        multiTimeframeFilter.allowed ? undefined : multiTimeframeFilter.reason,
      ].filter((item): item is string => Boolean(item));
      const candidateDecision = {
        decision: output.decision,
        confidence: output.confidence,
        strategyKey,
        provider: job.provider,
        timeframe: String(interval),
        marketRegime: output.regime.type,
        actionable,
        blockedReasons: [...new Set(blockedReasons)],
        advisoryReasons: 'advisory' in quant && quant.advisory && quant.reason ? [quant.reason] : [],
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
        createdAt: decisionCompletedAt.toISOString(),
      });
      const executionDecision = actionable
        ? output
        : { ...output, decision: "WAIT" as const };
      const volatilityAtr = preferredTradePlanAtr(
        indicatorSnapshot?.values.atr14,
        analyses.market?.volatility.atr,
      );
      let riskAssessment: Awaited<ReturnType<LiveTradingService["assessPipelineDecision"]>> | undefined;
      let liveExecution: Awaited<ReturnType<LiveTradingService["executePipeline"]>> | undefined;
      if (actionable) {
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
            },
          });
          if (riskAssessment.outcome === "NO_ELIGIBLE_EXCHANGE_CONNECTION") {
            throw new Error("NO_ELIGIBLE_EXCHANGE_CONNECTION: Active verified exchange connection is required to run live risk assessment.");
          }
          if (riskAssessment.outcome === "RISK_APPROVED") {
            liveExecution = await this.liveTrading.executePipeline(
              job.userId,
              runId,
            );
            if (liveExecution.outcome === "EXECUTION_FAILED" && liveExecution.retryable === true) {
              throw new PipelineExecutionRetryableError(
                liveExecution.errorCode ?? "RETRYABLE_EXCHANGE_FAILURE",
              );
            }
          }
        } finally {
          // Always release the lock — even if assessment or execution throws
          await this.redis.compareAndDelete(lockKey, runId);
        }
      }
      const completedAt = new Date();
      const risk = riskAssessment?.risk;
      const riskApproved = Boolean(risk?.approved);
      const orderSubmitted = liveExecution?.outcome === "ORDER_SUBMITTED";
      const finalSkippedReason = !actionable
        ? reason
        : !riskApproved
          ? risk?.reason ?? riskAssessment?.outcome ?? "RISK_NOT_APPROVED"
          : !orderSubmitted
            ? liveExecution?.errorCode ?? liveExecution?.outcome ?? "ORDER_NOT_SUBMITTED"
            : undefined;
      this.analytics.recordStageTelemetry({
        pipelineId: job.pipelineId,
        runId,
        symbol,
        exchange: String(job.provider),
        timeframe: String(job.params?.interval ?? definition.defaultParams.interval),
        stageName: 'execution',
        inputSummary: `decision=${executionDecision.decision}; confidence=${output.confidence}`,
        outputSummary: `risk=${risk?.reason ?? 'approved'}; live=${liveExecution?.outcome ?? 'unknown'}`,
        confidence: output.confidence,
        opportunityScore: output.opportunityScore,
        riskScore: risk?.riskScore ?? 0,
        decision: executionDecision.decision,
        rejectReason: finalSkippedReason,
        executionResult: orderSubmitted ? 'EXECUTED' : riskApproved ? 'RISK_APPROVED' : 'REJECTED',
        durationMs: completedAt.getTime() - startedAt.getTime(),
        tokenUsage: 0,
        apiCost: 0,
        createdAt: completedAt.toISOString(),
      });
      await this.repository.updateRun(runId, {
        status: "COMPLETED",
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        decision: executionDecision.decision,
        confidence: output.confidence,
        dataQuality: output.dataQuality,
        marketRegime: output.regime.type,
        configurationVersion: output.learningConfiguration?.version,
        learningStage: output.learningConfiguration?.stage,
        timeframe: String(interval),
        skippedReason: finalSkippedReason,
        storedContext: { analyses, fusionOutput, candidateDecision, strategySelection: executionStrategySelection as unknown as Prisma.InputJsonValue, multiTimeframe: multiTimeframe as unknown as Prisma.InputJsonValue, quant: quant as unknown as Prisma.InputJsonValue },
        result: {
          ...output,
          candidateDecision,
          selectedStrategyKey: strategyKey,
          strategySelection: executionStrategySelection as unknown as Prisma.InputJsonValue,
          actionable,
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
      if (!actionable) {
        await this.alerts.blockedOpportunity({
          runId,
          userId: job.userId,
          symbol,
          decision: candidateDecision.decision,
          confidence: candidateDecision.confidence,
          blockedReasons: candidateDecision.blockedReasons,
          analyses,
          multiTimeframeConfirmation: multiTimeframeFilter.confirmation,
        }).catch((error: unknown) => this.logger.warn({
          event: 'pipeline_blocked_opportunity_alert_failed',
          runId,
          symbol,
          message: error instanceof Error ? error.message : String(error),
        }));
      }
      if (actionable && riskApproved)
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
}
