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
import { PipelineThresholdService } from "./pipeline-threshold.service";
import { SignalFilterService } from "./signal-filter.service";
import { PipelineAlertService } from "./pipeline-alert.service";
import { DecisionRiskPolicyService } from "../../risk/application/decision-risk-policy.service";
import { PipelineAnalyticsService } from "./pipeline-analytics.service";
import { resolvePipelineDefinition } from "../domain/pipeline.definition";
import type { PipelineJob } from "../infrastructure/pipeline-queue.service";
import { LiveTradingService } from "../../live-trading/application/live-trading.service";
import {
  analysisParams,
  decisionForStrategy,
} from "../../portfolio/domain/strategy-decision";
import { MarketDataService } from "../../../market-data/application/market-data.service";
import { RedisService } from "../../../redis/redis.service";
import { DecisionJudgeService } from "./decision-judge.service";
import { preferredTradePlanAtr, timeframeMilliseconds } from "../domain/adaptive-trading-policy";
import { SettingsService } from "../../../settings/settings.service";
import {
  analyzeMultiTimeframe,
  evaluateMultiTimeframeDecision,
  selectPipelineTimeframes,
} from "../domain/multi-timeframe-analysis";

class PipelineCancelledError extends Error {}

@Injectable()
export class PipelineRunnerService {
  private readonly logger = new Logger(PipelineRunnerService.name);

  constructor(
    private readonly fusion: FusionService,
    private readonly decision: DecisionService,
    private readonly repository: PipelineRepository,
    private readonly cancellation: PipelineCancellationService,
    private readonly threshold: PipelineThresholdService,
    private readonly riskPolicy: DecisionRiskPolicyService,
    private readonly signalFilter: SignalFilterService,
    private readonly marketData: MarketDataService,
    private readonly alerts: PipelineAlertService,
    private readonly analytics: PipelineAnalyticsService,
    private readonly liveTrading: LiveTradingService,
    private readonly redis: RedisService,
    @Optional() private readonly judge?: DecisionJudgeService,
    @Optional() private readonly settings?: SettingsService,
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
    });
    await this.assertNotCancelled(runId);
    try {
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
      const multiTimeframe = analyzeMultiTimeframe(
        interval,
        timeframeMarketData.map((item) => ({
          timeframe: item.timeframe,
          close: item.candles[0] ? Number(item.candles[0].close) : undefined,
          ema20: Number(item.snapshot?.values.ema20),
          ema50: Number(item.snapshot?.values.ema50),
          rsi: Number(item.snapshot?.values.rsi14),
        })),
      );

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
      const strategyKey =
        typeof job.params?.strategyId === "string"
          ? job.params.strategyId
          : "ai-core";
      const output = decisionForStrategy(
        strategyKey,
        synthesizedOutput,
        analyses,
      );
      const decisionCompletedAt = new Date();
      const policyContext = { symbol, provider: job.provider, timeframe: String(interval), regime: output.regime.type };
      const thresholdFilter = this.threshold.evaluate(output, policyContext);
      const filter = this.riskPolicy.evaluate(output, policyContext);
      const judge = this.judge?.evaluate(output, analyses, {
        symbol,
        provider: job.provider,
        timeframe: String(interval),
        referencePrice: lastPrice,
        sourceTimestamp: indicatorSnapshot?.candleCloseTime ?? recentCandles[0]?.closeTime,
      }) ?? { verdict: 'APPROVE' as const, approved: true, reasons: [] };
      const multiTimeframeFilter = evaluateMultiTimeframeDecision(output.decision, multiTimeframe);
      const actionable = thresholdFilter.actionable && filter.actionable && judge.approved && multiTimeframeFilter.allowed;
      const reason = thresholdFilter.reason ?? filter.reason ?? judge.reasons[0] ?? multiTimeframeFilter.reason;
      await this.finishStep(runId, "decision", output, decisionCompletedAt);
      this.analytics.recordStageTelemetry({
        pipelineId: job.pipelineId,
        runId,
        symbol,
        exchange: String(job.provider),
        timeframe: String(job.params?.interval ?? definition.defaultParams.interval),
        stageName: 'decision',
        inputSummary: `regime=${output.regime.type}; conflict=${output.conflictLevel}`,
        outputSummary: `${output.decision}; confidence=${output.confidence}; ev=${output.expectedValue}`,
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
          // Another pipeline is currently inside the execution gate for this user.
          // Treat as WAIT — BullMQ retry will re-queue after backoffMs.
          this.logger.warn({
            event: 'pipeline_execution_lock_busy',
            userId: job.userId,
            runId,
            symbol,
          });
          await this.repository.updateRun(runId, {
            status: 'COMPLETED',
            completedAt: new Date(),
            durationMs: new Date().getTime() - startedAt.getTime(),
            decision: 'WAIT',
            confidence: output.confidence,
            dataQuality: output.dataQuality,
            marketRegime: output.regime.type,
            configurationVersion: output.learningConfiguration?.version,
            learningStage: output.learningConfiguration?.stage,
            timeframe: String(interval),
            skippedReason: 'EXECUTION_LOCK_BUSY',
            storedContext: { analyses, fusionOutput, multiTimeframe: multiTimeframe as unknown as Prisma.InputJsonValue },
            result: { ...output, decision: 'WAIT' as const, actionable: false, skippedReason: 'EXECUTION_LOCK_BUSY', multiTimeframe: multiTimeframe as unknown as Prisma.InputJsonValue },
          });
          return;
        }

        try {
          riskAssessment = await this.liveTrading.assessPipelineDecision({
            userId: job.userId,
            pipelineRunId: runId,
            symbol,
            provider: job.provider as unknown as ExchangeProvider,
            decision: executionDecision,
            ...(typeof job.params?.strategyId === "string"
              ? { strategyKey: job.params.strategyId }
              : {}),
            ...(volatilityAtr !== undefined
              ? { volatilityAtr }
              : {}),
            tradePlanContext: {
              timeframeMs: timeframeMilliseconds(String(interval)),
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
          liveExecution = await this.liveTrading.executePipeline(
            job.userId,
            runId,
          );
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
        storedContext: { analyses, fusionOutput, multiTimeframe: multiTimeframe as unknown as Prisma.InputJsonValue },
        result: {
          ...output,
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
        },
      });
      await this.alerts.contextual(runId, symbol, analyses);
      if (filter.actionable)
        await this.alerts.decision(runId, symbol, output);
    } catch (error) {
      const completedAt = new Date();
      const cancelled = error instanceof PipelineCancelledError;
      const timedOut =
        error instanceof Error && error.message === "PIPELINE_TIMEOUT";
      const isNoConnection =
        error instanceof Error && error.message.includes("NO_ELIGIBLE_EXCHANGE_CONNECTION");
      await this.repository.updateRun(runId, {
        status: cancelled ? "CANCELLED" : timedOut ? "TIMEOUT" : "FAILED",
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        errorCode: cancelled
          ? "CANCELLED_BY_USER"
          : timedOut
            ? "PIPELINE_TIMEOUT"
            : isNoConnection
              ? "NO_ELIGIBLE_EXCHANGE_CONNECTION"
              : "PIPELINE_EXECUTION_FAILED",
        safeErrorMessage:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Pipeline execution failed",
      });
      if (cancelled) return;
      await this.alerts.repeatedFailure(runId, symbol);
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
