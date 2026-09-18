import { applyThesisReview, validateTradeThesis, calculateThesisNetR } from '../../agents/domain/trade-thesis-validator';
import { anticipatoryDecisionContext } from '../../agents/domain/analysis/anticipatory-decision-context';
import { buildScenarioBlueprint } from '../../agents/domain/analysis/scenario-planning-engine';
import { composeEvidenceSize } from '../domain/evidence-gate';
import type { ProactiveExecutionContext } from '../../risk/domain/trade-plan-engine';
import { ThesisReviewSchema, type TradeThesis } from '@platform/shared';
import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
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
import { buildPinnedCoreAnalysis } from '../domain/pinned-core-analysis';
import { IndicatorStatus } from '../../../market-data/domain/market-data.enums';
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
import { randomUUID, createHash } from "node:crypto";
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
import { TradeResearcherService } from "../../agents/application/services/trade-researcher.service";
import { ChainOfThoughtReflectionService } from "../../agents/application/services/chain-of-thought-reflection.service";
import { AnticipatorySnapshotService } from "../../agents/application/services/anticipatory-snapshot.service";
import {
  selectBlockingGate,
  type GateDecisionRecord,
  type GateDisposition,
  type GateStage,
} from "../domain/gate-decision";
import { evaluateExecutionReadiness } from "../domain/execution-readiness";
import { buildEvaluationKey } from "../domain/evaluation-identity";

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
const BUILT_IN_CONFIGURATION_VERSION = 0;

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

function gateRecord(
  stage: GateStage,
  disposition: GateDisposition,
  reasonCodes: Array<string | undefined>,
): GateDecisionRecord {
  const uniqueReasonCodes = [...new Set(reasonCodes.filter(
    (reason): reason is string => typeof reason === "string" && reason.length > 0,
  ))];
  return {
    stage,
    disposition,
    reasonCodes: uniqueReasonCodes,
    ...(disposition === "BLOCK" && uniqueReasonCodes[0]
      ? { selectedBlockingReason: uniqueReasonCodes[0] }
      : {}),
  };
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
    @Optional() @Inject(TradeResearcherService) private readonly tradeResearcher?: TradeResearcherService,
    @Optional() @Inject(ChainOfThoughtReflectionService) private readonly critic?: ChainOfThoughtReflectionService,
    @Optional() @Inject(AnticipatorySnapshotService) private readonly anticipatorySnapshot?: AnticipatorySnapshotService,
  ) {}

  async run(
    job: PipelineJob,
  ): Promise<{ outcome: string; reason?: string } | undefined> {
    const definition = resolvePipelineDefinition(job.pipelineId);
    
    // Only the declared release modes can enter the proactive pipeline.
    const proactiveMode = process.env.PROACTIVE_AI_MODE ?? "OBSERVE";
    if (job.pipelineId === "proactive-thesis") {
      if (!["OBSERVE", "SHADOW", "DEMO"].includes(proactiveMode)) {
        const completedAt = new Date();
        await this.finalizeEarlyTerminalRun(
          String(job.runId),
          {
            status: "SKIPPED",
            decision: "WAIT",
            skippedReason: "PROACTIVE_AI_MODE_INVALID",
          },
          "PROACTIVE_AI_MODE_INVALID",
          completedAt,
        );
        return { outcome: "SKIPPED", reason: "PROACTIVE_AI_MODE_INVALID" };
      }
      if (proactiveMode === "DEMO") {
        const demoVerified = await this.liveTrading.hasVerifiedDemoConnection(job.userId);
        if (!demoVerified) throw new Error("NO_ELIGIBLE_EXCHANGE_CONNECTION: DEMO requires verified demo connection.");
      }
    }
    if (!definition?.enabled) throw new Error("PIPELINE_NOT_FOUND_OR_DISABLED");
    const startedAt = new Date();
    const symbol = String(job.symbol);
    const runId = String(job.runId);
    let evaluatedGateRecords: GateDecisionRecord[] | undefined;
    let evaluatedResult: Record<string, unknown> | undefined;
    let riskStageReached = false;
    let executionStageReached = false;
    let riskAssessment: Awaited<ReturnType<LiveTradingService["assessPipelineDecision"]>> | undefined;
    let liveExecution: Awaited<ReturnType<LiveTradingService["executePipeline"]>> | undefined;
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
        const completedAt = new Date();
        await this.finalizeEarlyTerminalRun(
          runId,
          {
            status: "SKIPPED",
            decision: "WAIT",
            skippedReason: "NO_ACTIVE_STRATEGY",
            durationMs: Math.max(0, Date.now() - startedAt.getTime()),
            result: {
              requestedStrategyKeys,
              symbol,
            },
          },
          "NO_ACTIVE_STRATEGY",
          completedAt,
        );
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
            // Refresh candles before reading indicators: parallel reads could
            // capture the old cache while the candle read builds a new bucket.
            const chronologicalCandles = await this.marketData.getHistoricalCandles({
                provider: job.provider as unknown as ExchangeProvider,
                symbol,
                interval: timeframe as ExchangeInterval,
                limit: 250,
              });
            const snapshot = await this.marketData.getIndicatorSnapshot(
                job.provider as unknown as ExchangeProvider, symbol, timeframe as ExchangeInterval);
            const referenceCandle = chronologicalCandles.filter(candle =>
              candle.isClosed !== false && new Date(candle.closeTime).getTime() === new Date(snapshot?.candleCloseTime ?? 0).getTime()).at(-1);
            return { timeframe, snapshot, candles: [...chronologicalCandles].reverse(), referenceCandle };
          } catch (error) {
            this.logger.warn({
              event: 'pipeline_timeframe_data_unavailable',
              runId,
              symbol,
              timeframe,
              message: error instanceof Error ? error.message : 'Unknown market-data error',
            });
            return { timeframe, snapshot: undefined, candles: [], referenceCandle: undefined };
          }
        }),
      );
      const primaryMarketData = timeframeMarketData.find((item) => item.timeframe === interval)!;
      const indicatorSnapshot = primaryMarketData.snapshot;
      const recentCandles = primaryMarketData.candles;
      const pinnedCore = buildPinnedCoreAnalysis(indicatorSnapshot, recentCandles);
      const lastPrice = primaryMarketData.referenceCandle ? Number(primaryMarketData.referenceCandle.close) : undefined;
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
          const maxAgeMs = timeframeMilliseconds(item.timeframe) + 5_000;
          return (
            !item.referenceCandle ||
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
          .filter((item) => !staleTimeframeSet.has(item.timeframe) &&
            item.referenceCandle?.isClosed === true && item.snapshot?.status === IndicatorStatus.CLOSED &&
            new Date(item.referenceCandle.closeTime).getTime() <= new Date(indicatorSnapshot?.candleCloseTime ?? 0).getTime())
          .map((item) => ({
            timeframe: item.timeframe,
            close: item.referenceCandle ? Number(item.referenceCandle.close) : undefined,
            ema20: Number(item.snapshot?.values.ema20),
            ema50: Number(item.snapshot?.values.ema50),
            rsi: Number(item.snapshot?.values.rsi14),
            isClosed: item.referenceCandle?.isClosed,
          })),
      );
      const closedCandleEvidence = pinnedCore ? { ...pinnedCore.executionEvidence, multiTimeframe } : undefined;

      // Only reject if the primary execution timeframe itself is stale.
      // Secondary/optional timeframes are excluded above for graceful degradation.
      if (staleTimeframeSet.has(interval)) {
        const completedAt = new Date();
        const reason = `STALE_MARKET_DATA:${staleTimeframes.join(',')}`;
        this.logger.warn({
          event: 'pipeline_stale_market_data_rejected',
          runId,
          symbol,
          interval,
          staleTimeframes,
        });
        await this.finalizeEarlyTerminalRun(
          runId,
          {
            status: 'COMPLETED',
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
          },
          reason,
          completedAt,
        );
        return;
      }
      if (staleTimeframes.length > 0) {
        this.logger.warn({
          event: 'pipeline_optional_timeframe_data_ignored',
          runId,
          symbol,
          interval,
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
        await this.finalizeEarlyTerminalRun(
          runId,
          {
            status: "COMPLETED",
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
          },
          signalFilter.reason ?? "SIGNAL_FILTER_BLOCKED",
          completedAt,
        );
        return;
      }
      const existing = job.useStoredContext
        ? await this.repository.findRun(runId)
        : undefined;
      const stored = existing?.storedContext as {
        analyses?: FusionInput;
        fusionOutput?: FusionOutput;
      } | null;
      // Stored analyses have no technical cutoff provenance. Recompute fusion
      // against the pinned bundle before allowing closed-candle execution.
      if (!pinnedCore && stored?.analyses && stored.fusionOutput) {
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
            coreSnapshot: pinnedCore,
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
      let synthesizedOutput: DecisionOutput;
      let proactiveThesis: TradeThesis | undefined;
      let proactive: ProactiveExecutionContext | undefined;
      let criticSizeFactor = 1;
      
      if (job.pipelineId === 'proactive-thesis' && this.tradeResearcher && this.critic && this.anticipatorySnapshot) {
        const executionEvidence = await this.liveTrading.proactiveExecutionEvidence(job.userId, job.provider as ExchangeProvider, symbol);
        const snapshot = await this.anticipatorySnapshot.build({
          userId: job.userId,
          symbol,
          provider: job.provider as ExchangeProvider,
          timeframe: String(interval) as ExchangeInterval,
          sourceDataCutoff: new Date(), execution: executionEvidence,
        });
        const context = {
          userId: job.userId,
          configHash: createHash('sha256').update(JSON.stringify({ params: job.params, mode: proactiveMode, schemaVersion: snapshot.schemaVersion, calculationVersion: snapshot.calculationVersion, researcherPrompt: 1, criticPrompt: 1 })).digest('hex'),
          parentSnapshotId: runId, promptVersion: 1,
        };
        const research = await this.tradeResearcher.research(snapshot, context);
        const features = anticipatoryDecisionContext(snapshot);
        const baseline = await this.decision.decideForUser({ symbol, fusionOutput, ...analyses }, job.userId, {
          pipelineRunId: runId, provider: job.provider, timeframe: String(interval), referencePrice: lastPrice,
          anticipatorySnapshot: snapshot,
          closedCandleEvidence,
        });
        const review = ThesisReviewSchema.parse(await this.critic.reflect({ snapshot, thesis: research.preferred,
          scenarios: baseline.scenarios, cohortEvidence: baseline.confidenceCalibration }, job.userId));
        proactiveThesis = applyThesisReview(research.preferred, review);
        const validation = validateTradeThesis({ ...proactiveThesis, evidenceAgainst: [...proactiveThesis.evidenceAgainst, ...review.evidenceRefs] }, snapshot, { now: new Date() });
        await this.tradeResearcher.persistReview({ context, research, review, appliedThesis: proactiveThesis, validation });
        if (!validation.valid || !['PROBE_READY', 'CONFIRMED'].includes(proactiveThesis.state) || proactiveThesis.direction === 'WAIT') {
          const reason = validation.reasonCodes[0] ?? 'THESIS_NOT_EXECUTABLE';
          const completedAt = new Date();
          await this.finishStep(runId, 'decision', { thesis: proactiveThesis, review, validation }, completedAt);
          await this.finalizeEarlyTerminalRun(
            runId,
            { status: 'SKIPPED', decision: 'WAIT', skippedReason: reason },
            reason,
            completedAt,
          );
          return { outcome: 'SKIPPED', reason };
        }
        if (!research.researchRunId) throw new Error('THESIS_AUDIT_PARENT_REQUIRED');
        criticSizeFactor = review.action === 'REDUCE_SIZE' ? (review.sizeFactor ?? 0) : 1;
        proactive = { thesisId: research.researchRunId, thesis: proactiveThesis, snapshot,
          mode: proactiveMode as ProactiveExecutionContext['mode'], sizeFactor: 1 };
        const netR = calculateThesisNetR(proactiveThesis, snapshot) ?? 0;
        const probability = baseline.expectedWinProbability;
        const type = proactiveThesis.regime.includes('RANGING') ? 'RANGING' as const
          : proactiveThesis.regime.includes('VOLATIL') ? 'HIGH_VOLATILITY' as const
          : proactiveThesis.regime.startsWith('PRE_') ? 'RANGING' as const : baseline.regime.type;
        synthesizedOutput = { ...baseline,
          decision: proactiveThesis.direction, decisionSource: proactiveThesis.decisionSource,
          confidence: proactiveThesis.confidence, regime: { ...baseline.regime, type },
          expectedReward: netR, expectedLoss: 1, executionCost: 0,
          expectedValue: probability * netR - (1 - probability),
          profitFactorEstimate: probability * netR / Math.max(0.01, 1 - probability),
          anticipatorySignals: features.signals,
          reasoning: proactiveThesis.setup,
        };
        synthesizedOutput.scenarios = buildScenarioBlueprint({ decision: synthesizedOutput.decision, confidence: synthesizedOutput.confidence,
          regime: synthesizedOutput.regime, currentPrice: features.market.currentPrice, atr: features.market.atr,
          supportLevel: features.market.support, resistanceLevel: features.market.resistance,
          hasSfpWick: features.market.liquiditySweep, anticipatorySignals: features.signals });
      } else {
        synthesizedOutput = await this.decision.decideForUser({
          symbol,
          fusionOutput,
          ...analyses,
        }, job.userId, {
          pipelineRunId: runId,
          provider: job.provider,
          timeframe: String(interval),
          referencePrice: lastPrice,
          closedCandleEvidence,
        });
      }
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
      const rankedCandidates = proactive ? [{ strategyKey: 'ai-core', decision: synthesizedOutput, score: synthesizedOutput.opportunityScore }] : rankStrategyDecisionCandidates(
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
        inputDecision: string;
        decision: string;
        score: number;
        actionable: boolean;
        blockedReasons: string[];
        advisoryReasons: string[];
        gates: GateDecisionRecord[];
      }> = [];
      let selectedGate: {
        strategyKey: string;
        output: Awaited<ReturnType<DecisionService["calibrateForExecution"]>>;
        judge: ReturnType<DecisionJudgeService["evaluate"]>;
        multiTimeframeFilter: ReturnType<typeof evaluateMultiTimeframeDecision>;
        quant: Awaited<ReturnType<QuantExecutionPolicyService["evaluate"]>>;
        actionable: boolean;
        dislocationCanary: boolean;
        blockedReasons: string[];
        advisoryReasons: string[];
        gates: GateDecisionRecord[];
      } | undefined;
      for (const candidate of rankedCandidates) {
        const calibrated = await this.decision.calibrateForExecution(
          closedCandleEvidence
            ? this.decision.withClosedCandleExecutionContext(candidate.decision, closedCandleEvidence, candidate.strategyKey)
            : candidate.decision,
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
        const candidateReadiness = evaluateExecutionReadiness(calibrated);
        const candidateJudge = this.judge?.evaluate(calibrated, analyses, {
          symbol,
          provider: job.provider,
          timeframe: String(interval),
          referencePrice: lastPrice,
          sourceTimestamp: indicatorSnapshot?.candleCloseTime ?? recentCandles[0]?.closeTime,
          requireCalibratedConfidence: true,
          mode: proactive ? proactive.mode === 'DEMO' ? 'DEMO' : 'SHADOW' : process.env.TRADING_MODE === 'LIVE' ? 'LIVE' : 'DEMO',
        }) ?? { verdict: 'APPROVE' as const, severity: 'APPROVE' as const, approved: true, reasons: [] };
        const candidateMultiTimeframe = evaluateMultiTimeframeDecision(calibrated.decision, multiTimeframe);
        const candidateQuant = this.quantPolicy
          ? await this.quantPolicy.evaluate({
              userId: job.userId,
              symbol,
              provider: job.provider,
              timeframe: String(interval),
              strategyKey: candidate.strategyKey,
              mode: proactive ? proactive.mode === 'DEMO' ? 'DEMO' : 'SHADOW' : process.env.TRADING_MODE === 'LIVE' ? 'LIVE' : 'DEMO',
              decision: calibrated,
              executionReady: candidateReadiness.allowed,
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
              return { severity: 'BLOCK' as const, riskTier: 'BLOCKED' as const, executionPolicy: 'BLOCK' as const, allowed: false as const, advisory: false as const, reason: "QUANT_POLICY_UNAVAILABLE" as const };
            })
          : { severity: 'BLOCK' as const, riskTier: 'BLOCKED' as const, executionPolicy: 'BLOCK' as const, allowed: false as const, advisory: false as const, reason: "QUANT_VALIDATION_MISSING" as const };
        const candidateBlockedReasons = [
          candidateFilter.reason,
          ...candidateReadiness.reasonCodes,
          ...candidateJudge.reasons,
          candidateQuant.allowed ? undefined : candidateQuant.reason,
          candidateMultiTimeframe.allowed ? undefined : candidateMultiTimeframe.reason,
        ].filter((item): item is string => Boolean(item));
        const standardActionable = candidateFilter.actionable && candidateReadiness.allowed && candidateJudge.approved &&
          candidateQuant.allowed && candidateQuant.dislocationCanary !== true &&
          candidateMultiTimeframe.allowed;
        const filterCanaryCompatible = candidateFilter.actionable ||
          (typeof candidateFilter.reason === "string" &&
            DISLOCATION_CANARY_ADVISORY_REASONS.has(candidateFilter.reason));
        const judgeCanaryCompatible = candidateJudge.approved ||
          (candidateJudge.reasons.length > 0 &&
            historicalGateReasonsAreAdvisory(candidateJudge.reasons));
        const dislocationCanary = !standardActionable &&
          candidateReadiness.allowed &&
          candidateQuant.allowed &&
          candidateQuant.dislocationCanary === true &&
          candidateMultiTimeframe.allowed &&
          filterCanaryCompatible &&
          judgeCanaryCompatible &&
          historicalGateReasonsAreAdvisory(candidateBlockedReasons);
        const candidateActionable = standardActionable || dislocationCanary;
        const candidateGates: GateDecisionRecord[] = [
          gateRecord(
            "SIGNAL_FILTER",
            candidateFilter.actionable
              ? "PASS"
              : dislocationCanary ? "ADVISORY" : "BLOCK",
            calibrated.calibrationBlockingReasons?.length
              ? calibrated.calibrationBlockingReasons : [candidateFilter.reason],
          ),
          gateRecord(
            "EXECUTION_READINESS",
            candidateReadiness.allowed ? "PASS" : "BLOCK",
            candidateReadiness.reasonCodes,
          ),
          gateRecord(
            "JUDGE",
            candidateJudge.approved
              ? candidateJudge.severity === "REDUCE_SIZE" ? "REDUCE_SIZE" : "PASS"
              : dislocationCanary ? "ADVISORY" : "BLOCK",
            candidateJudge.reasons,
          ),
          gateRecord(
            "QUANT",
            !candidateQuant.allowed
              ? candidateQuant.executionPolicy === "ADVISORY" || candidateQuant.advisory
                ? "ADVISORY"
                : "BLOCK"
              : candidateQuant.severity === "REDUCE_SIZE"
                ? "REDUCE_SIZE"
                : candidateQuant.advisory ? "ADVISORY" : "PASS",
            [
              candidateQuant.reason,
              ...("reasons" in candidateQuant ? candidateQuant.reasons ?? [] : []),
            ],
          ),
          gateRecord(
            "MULTI_TIMEFRAME",
            candidateMultiTimeframe.allowed ? "PASS" : "BLOCK",
            [candidateMultiTimeframe.reason],
          ),
        ];
        const canonicalBlockedReasons = candidateGates
          .filter((gate) => gate.disposition === "BLOCK")
          .flatMap((gate) => gate.reasonCodes);
        const advisoryReasons = candidateGates
          .filter((gate) => gate.disposition === "ADVISORY" || gate.disposition === "REDUCE_SIZE")
          .flatMap((gate) => gate.reasonCodes);
        const evaluated = {
          strategyKey: candidate.strategyKey,
          output: calibrated,
          judge: candidateJudge,
          multiTimeframeFilter: candidateMultiTimeframe,
          quant: candidateQuant,
          actionable: candidateActionable,
          dislocationCanary,
          blockedReasons: canonicalBlockedReasons,
          advisoryReasons,
          gates: candidateGates,
        };
        gateAttempts.push({
          strategyKey: candidate.strategyKey,
          inputDecision: candidate.decision.decision,
          decision: calibrated.decision,
          score: candidate.score,
          actionable: candidateActionable,
          blockedReasons: [...new Set(evaluated.blockedReasons)],
          advisoryReasons: [...new Set(advisoryReasons)],
          gates: candidateGates,
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
        judge,
        multiTimeframeFilter,
        quant,
        actionable,
        dislocationCanary,
        blockedReasons: selectedBlockedReasons,
        advisoryReasons: selectedAdvisoryReasons,
        gates: candidateGates,
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
      const sourceDataCutoff = indicatorSnapshot?.candleCloseTime ?? recentCandles[0]?.closeTime;
      const sourceDataAgeMs = sourceTimestamp
        ? Math.max(0, decisionCompletedAt.getTime() - new Date(sourceTimestamp).getTime())
        : undefined;
      const configurationVersion = output.learningConfiguration?.version ??
        BUILT_IN_CONFIGURATION_VERSION;
      const evaluationIdentity = sourceDataCutoff
        ? {
            userId: job.userId,
            provider: String(job.provider),
            symbol,
            timeframe: String(interval),
            sourceDataCutoff: new Date(sourceDataCutoff),
            strategyKey,
            direction: output.decision,
            configurationVersion,
          }
        : undefined;
      const evaluationKey = evaluationIdentity
        ? buildEvaluationKey(evaluationIdentity)
        : undefined;
      if (evaluationKey) {
        const identityResult = await this.repository.persistEvaluationIdentity?.(
          runId,
          evaluationKey,
          evaluationIdentity,
        );
        if (identityResult?.sampleReused) {
          this.logger.log({
            event: "pipeline_evaluation_sample_reused",
            runId,
            evaluationKey,
            paperSignalId: identityResult.paperSignal?.id,
          });
        }
      }
      const candidateBlockingGate = selectBlockingGate(candidateGates);
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
        ...(output.executionContext ? { executionContext: output.executionContext } : {}),
      };
      evaluatedGateRecords = [...candidateGates];
      evaluatedResult = {
        ...output,
        decision: actionable ? output.decision : "WAIT",
        candidateDecision,
        selectedStrategyKey: strategyKey,
        strategySelection: executionStrategySelection as unknown as Prisma.InputJsonValue,
        actionable,
        skippedReason: candidateBlockingGate?.reason ?? null,
        gates: evaluatedGateRecords as unknown as Prisma.InputJsonValue,
        ...(candidateBlockingGate
          ? { blockingGate: candidateBlockingGate as unknown as Prisma.InputJsonValue }
          : {}),
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
        judge: judge as unknown as Prisma.InputJsonValue,
        quant: quant as unknown as Prisma.InputJsonValue,
      };
      await this.repository.updateRun(runId, {
        evaluationKey,
        configurationVersion,
        skippedReason: candidateBlockingGate?.reason ?? null,
        result: evaluatedResult as unknown as Prisma.InputJsonValue,
      });
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
        decision: actionable ? output.decision : 'WAIT',
        candidateDecision: output.decision,
        candidateConfidence: output.confidence,
        rejectReason: candidateBlockingGate?.reason,
        blockingStage: candidateBlockingGate?.stage,
        executionResult: actionable ? 'APPROVED' : 'REJECTED',
        durationMs: decisionCompletedAt.getTime() - startedAt.getTime(),
        tokenUsage: 0,
        apiCost: 0,
        cacheHits: analysisCacheHits,
        sourceDataAgeMs,
        createdAt: decisionCompletedAt.toISOString(),
      });
      const composedSize = composeEvidenceSize([judge, { severity: quant.severity, sizeFactor: quant.sizeFactor, reasons: quant.reasons ?? [] },
        { severity: criticSizeFactor < 1 ? 'REDUCE_SIZE' : 'APPROVE', sizeFactor: criticSizeFactor, reasons: [] }]);
      if (proactive) proactive.sizeFactor = composedSize.sizeFactor ?? 1;
      const executionDecision = actionable && composedSize.severity !== 'BLOCK'
        ? output
        : { ...output, decision: "WAIT" as const };
      const volatilityAtr = proactive?.snapshot.volatility.coverage === 'AVAILABLE' ? proactive.snapshot.volatility.atr : preferredTradePlanAtr(
        indicatorSnapshot?.values.atr14,
        analyses.market?.volatility.atr,
      );
      const primaryCandle = recentCandles[0];
      const volumeRatio = Number.isFinite(Number(indicatorSnapshot?.values.volumeChangePercent))
        ? 1 + Number(indicatorSnapshot?.values.volumeChangePercent) / 100
        : undefined;
      let submissionStartedAt: Date | undefined;
      let executionGateReason: string | undefined;
      let canaryCooldownKey: string | undefined;
      let retainCanaryCooldown = false;
      let pipelineOutcome: { outcome: string; reason?: string } | undefined;
      // Proactive theses must retain their mode guard and pinned demo connection;
      // generic confluence execution does not carry those release constraints.
      if (actionable && job.pipelineId !== "proactive-thesis" && job.confluenceBatchId && this.confluenceCollector) {
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
            ...(output.executionContext ? { canonicalExecutionContext: output.executionContext } : {}),
            tradePlanContext: {
                  ...(Number.isFinite(lastPrice) ? { currentPrice: lastPrice } : {}),
                  ...(indicatorSnapshot?.values?.squeezeState ? { squeezeState: indicatorSnapshot.values.squeezeState } : {}),
                  gateSeverity: judge?.severity === 'REDUCE_SIZE' || (quant && 'severity' in quant && quant.severity === 'REDUCE_SIZE') ? 'REDUCE_SIZE' : 'APPROVE',
                  ...(synthesizedOutput?.anticipatorySignals?.liquiditySweep ? { liquiditySweep: synthesizedOutput.anticipatorySignals.liquiditySweep.detected } : {}),
                  ...(synthesizedOutput?.anticipatorySignals?.derivativesImbalance?.squeezeProbability !== undefined ? { derivativesImbalance: synthesizedOutput.anticipatorySignals.derivativesImbalance.squeezeProbability } : {}),
                  ...(synthesizedOutput?.executionContext ? { executionContext: synthesizedOutput.executionContext } : {}),
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
          if (proactive?.thesis.setup === 'RECOVERY_RECLAIM' || output.reasoning === 'RECOVERY_RECLAIM') {
            executionGateReason = "RECOVERY_SHADOW_ONLY";
            pipelineOutcome = { outcome: "SKIPPED", reason: "RECOVERY_SHADOW_ONLY" };
          }
          if (!executionGateReason) {
            const assess = async () => {
              riskStageReached = true;
              riskAssessment = undefined;
              executionStageReached = false;
              liveExecution = undefined;
              riskAssessment = await this.liveTrading.assessPipelineDecision({
                userId: job.userId,
                pipelineRunId: runId,
                ...(job.pipelineId === "proactive-thesis" && proactiveMode === "DEMO"
                  ? { requiredEnvironment: "DEMO" as const }
                  : {}),
                symbol,
                provider: job.provider as unknown as ExchangeProvider,
                decision: executionDecision,
                // Momentum scalp currently shares the governed breakout portfolio
                // bucket while retaining its own decision/quant identity.
                strategyKey: strategyKey === "momentum-scalp" ? "breakout" : strategyKey,
                executionSizeFactor: proactive ? undefined : composedSize.sizeFactor,
                ...(volatilityAtr !== undefined
                  ? { volatilityAtr }
                  : {}),
                tradePlanContext: {
                  ...(proactive ? { proactive } : {}),
                  ...(Number.isFinite(lastPrice) ? { currentPrice: lastPrice } : {}),
                  ...(indicatorSnapshot?.values?.squeezeState ? { squeezeState: indicatorSnapshot.values.squeezeState } : {}),
                  gateSeverity: judge?.severity === 'REDUCE_SIZE' || (quant && 'severity' in quant && quant.severity === 'REDUCE_SIZE') ? 'REDUCE_SIZE' : 'APPROVE',
                  ...(synthesizedOutput?.anticipatorySignals?.liquiditySweep ? { liquiditySweep: synthesizedOutput.anticipatorySignals.liquiditySweep.detected } : {}),
                  ...(synthesizedOutput?.anticipatorySignals?.derivativesImbalance?.squeezeProbability !== undefined ? { derivativesImbalance: synthesizedOutput.anticipatorySignals.derivativesImbalance.squeezeProbability } : {}),
                  ...(synthesizedOutput?.executionContext ? { executionContext: synthesizedOutput.executionContext } : {}),
                  ...(proactive ? anticipatoryDecisionContext(proactive.snapshot).market : {}),
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
                  ...(proactive ? anticipatoryDecisionContext(proactive.snapshot).market : {}),
                },
              });
              if (riskAssessment.outcome === "NO_ELIGIBLE_EXCHANGE_CONNECTION") {
                throw new Error("NO_ELIGIBLE_EXCHANGE_CONNECTION: Active verified exchange connection is required to run live risk assessment.");
              }
            };

            const execute = async () => {
              if (riskAssessment?.outcome === "RISK_APPROVED") {
                executionStageReached = true;
                liveExecution = undefined;
                if (job.pipelineId === 'proactive-thesis' && proactiveMode !== 'DEMO') {
                  return { outcome: 'SKIPPED' as const, reason: 'SKIPPED_BY_PROACTIVE_MODE' };
                }
                submissionStartedAt = new Date();
                const execution = job.pipelineId === "proactive-thesis"
                  ? await this.liveTrading.executePipeline(job.userId, runId, { requiredEnvironment: "DEMO" })
                  : await this.liveTrading.executePipeline(job.userId, runId);
                liveExecution = execution;
                return execution;
              }
              return { outcome: riskAssessment?.outcome ?? "SKIPPED" };
            };

            const finalExecution = await executeWithSingleDriftReassessment({
              assess,
              execute,
            });
            pipelineOutcome = {
              outcome: finalExecution.outcome,
              ...('reason' in finalExecution && finalExecution.reason
                ? { reason: finalExecution.reason }
                : {}),
            };
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
      const gates = [...candidateGates];
      if (executionGateReason) {
        gates.push(gateRecord("EXECUTION", "BLOCK", [executionGateReason]));
      } else if (riskAssessment) {
        const riskReason = riskApproved
          ? risk?.reason
          : risk?.reason ?? riskAssessment.outcome ?? "RISK_NOT_APPROVED";
        gates.push(gateRecord(
          "RISK",
          riskApproved ? "PASS" : "BLOCK",
          [riskReason],
        ));
        if (riskApproved) {
          const executionReason = orderSubmitted
            ? undefined
            : liveExecution?.errorCode ?? liveExecution?.outcome ?? "ORDER_NOT_SUBMITTED";
          gates.push(gateRecord(
            "EXECUTION",
            orderSubmitted ? "PASS" : "BLOCK",
            [executionReason],
          ));
        }
      }
      const blockingGate = selectBlockingGate(gates);
      const finalSkippedReason = blockingGate?.reason;
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
        candidateDecision: finalCandidateDecision.decision,
        candidateConfidence: finalCandidateDecision.confidence,
        rejectReason: blockingGate?.reason,
        blockingStage: blockingGate?.stage,
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
        configurationVersion,
        evaluationKey,
        learningStage: output.learningConfiguration?.stage,
        timeframe: String(interval),
        skippedReason: finalSkippedReason ?? null,
        storedContext: { analyses, fusionOutput, candidateDecision: finalCandidateDecision, strategySelection: executionStrategySelection as unknown as Prisma.InputJsonValue, multiTimeframe: multiTimeframe as unknown as Prisma.InputJsonValue, quant: quant as unknown as Prisma.InputJsonValue, ...(output.executionContext ? { executionContext: output.executionContext as unknown as Prisma.InputJsonValue } : {}) },
        result: {
          ...output,
          decision: finalExecutionDecision.decision,
          candidateDecision: finalCandidateDecision,
          selectedStrategyKey: strategyKey,
          strategySelection: executionStrategySelection as unknown as Prisma.InputJsonValue,
          actionable: finalActionable,
          skippedReason: finalSkippedReason ?? null,
          gates: gates as unknown as Prisma.InputJsonValue,
          ...(blockingGate
            ? { blockingGate: blockingGate as unknown as Prisma.InputJsonValue }
            : {}),
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
      if (typeof this.repository.skipOpenSteps === 'function') {
        await this.repository.skipOpenSteps(runId, finalSkippedReason ?? "COMPLETED", completedAt);
      }
      await this.alerts.contextual(runId, symbol, analyses);
      if (!finalActionable && blockingGate) {
        await this.alerts.blockedOpportunity({
          runId,
          userId: job.userId,
          symbol,
          decision: finalCandidateDecision.decision,
          confidence: finalCandidateDecision.confidence,
          blockingGate,
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
      return pipelineOutcome;
    } catch (error) {
      const completedAt = new Date();
      const cancelled = error instanceof PipelineCancelledError;
      const executionLockBusy = error instanceof PipelineExecutionLockBusyError;
      const executionRetryable = error instanceof PipelineExecutionRetryableError;
      const timedOut =
        error instanceof Error && error.message === "PIPELINE_TIMEOUT";
      const isNoConnection =
        error instanceof Error && error.message.includes("NO_ELIGIBLE_EXCHANGE_CONNECTION");
      const errorCode = cancelled
        ? "CANCELLED_BY_USER"
        : executionLockBusy
          ? "EXECUTION_LOCK_BUSY"
          : timedOut
            ? "PIPELINE_TIMEOUT"
            : isNoConnection
              ? "NO_ELIGIBLE_EXCHANGE_CONNECTION"
              : executionRetryable
                ? "RETRYABLE_EXCHANGE_FAILURE"
                : "PIPELINE_EXECUTION_FAILED";
      const failureGates = evaluatedGateRecords
        ? [...evaluatedGateRecords]
        : undefined;
      if (failureGates && riskStageReached) {
        const risk = riskAssessment?.risk;
        const riskApproved = Boolean(risk?.approved);
        failureGates.push(gateRecord(
          "RISK",
          riskApproved ? "PASS" : "BLOCK",
          [riskApproved
            ? risk?.reason
            : risk?.reason ?? riskAssessment?.outcome ?? errorCode],
        ));
      }
      if (failureGates && executionStageReached) {
        const orderSubmitted = liveExecution?.outcome === "ORDER_SUBMITTED";
        failureGates.push(gateRecord(
          "EXECUTION",
          orderSubmitted ? "PASS" : "BLOCK",
          [orderSubmitted
            ? undefined
            : liveExecution?.errorCode ?? liveExecution?.outcome ?? errorCode],
        ));
      }
      const failureBlockingGate = failureGates
        ? selectBlockingGate(failureGates)
        : undefined;
      if (!executionLockBusy) {
        await this.finalizeEarlyTerminalRun(
          runId,
          {
            status: cancelled ? "CANCELLED" : timedOut ? "TIMEOUT" : "FAILED",
            durationMs: completedAt.getTime() - startedAt.getTime(),
            errorCode,
            skippedReason: failureBlockingGate?.reason ?? null,
            safeErrorMessage:
              error instanceof Error
                ? error.message.slice(0, 300)
                : "Pipeline execution failed",
            ...(evaluatedResult && failureGates
              ? {
                  result: {
                    ...evaluatedResult,
                    skippedReason: failureBlockingGate?.reason ?? null,
                    gates: failureGates as unknown as Prisma.InputJsonValue,
                    ...(failureBlockingGate
                      ? { blockingGate: failureBlockingGate as unknown as Prisma.InputJsonValue }
                      : {}),
                    riskAssessment,
                    liveExecution,
                  },
                }
              : {}),
          },
          cancelled ? "CANCELLED" : failureBlockingGate?.reason ?? errorCode ?? "PIPELINE_FAILED",
          completedAt,
        );
      } else {
        await this.repository.updateRun(runId, {
          status: "QUEUED",
          completedAt: null,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          errorCode,
          skippedReason: failureBlockingGate?.reason ?? null,
          safeErrorMessage:
            error instanceof Error
              ? error.message.slice(0, 300)
              : "Pipeline execution failed",
          ...(evaluatedResult && failureGates
            ? {
                result: {
                  ...evaluatedResult,
                  skippedReason: failureBlockingGate?.reason ?? null,
                  gates: failureGates as unknown as Prisma.InputJsonValue,
                  ...(failureBlockingGate
                    ? { blockingGate: failureBlockingGate as unknown as Prisma.InputJsonValue }
                    : {}),
                  riskAssessment,
                  liveExecution,
                },
              }
            : {}),
        });
      }
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
  private async finalizeEarlyTerminalRun(
    runId: string,
    data: Prisma.PipelineRunUpdateInput,
    reason: string,
    completedAt: Date = new Date(),
  ): Promise<void> {
    await this.repository.updateRun(runId, {
      ...data,
      completedAt,
    });
    if (typeof this.repository.skipOpenSteps === 'function') {
      await this.repository.skipOpenSteps(runId, reason, completedAt);
    }
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

    const records = await Promise.all(evaluation.rejected.map(
      async (signal: ConfluenceSignal) => {
        const run = await this.repository.findRun(signal.pipelineRunId);
        return {
          id: randomUUID(),
          userId,
          pipelineRunId: signal.pipelineRunId,
          evaluationKey: run?.evaluationKey ?? undefined,
          symbol: signal.symbol,
          provider: signal.executionContext.provider as unknown as ExchangeProvider,
          decision: signal.decision,
          confidence: signal.confidence,
          mode: "CONFLUENCE_REJECTED",
          referencePrice: signal.referencePrice,
          outcome: "PENDING",
          marketRegime: signal.regime,
        };
      },
    ));

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
