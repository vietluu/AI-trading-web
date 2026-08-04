import { Injectable, Logger } from "@nestjs/common";
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
import { resolvePipelineDefinition } from "../domain/pipeline.definition";
import type { PipelineJob } from "../infrastructure/pipeline-queue.service";
import { LiveTradingService } from "../../live-trading/application/live-trading.service";
import {
  analysisParams,
  decisionForStrategy,
} from "../../portfolio/domain/strategy-decision";
import { MarketDataService } from "../../../market-data/application/market-data.service";

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
    private readonly signalFilter: SignalFilterService,
    private readonly marketData: MarketDataService,
    private readonly alerts: PipelineAlertService,
    private readonly liveTrading: LiveTradingService,
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
      const interval = (job.params?.interval as string | undefined) ?? definition.defaultParams.interval;
      const indicatorSnapshot = await this.marketData.getIndicatorSnapshot(
        job.provider as unknown as ExchangeProvider,
        symbol,
        (interval as ExchangeInterval) ?? ExchangeInterval.ONE_HOUR,
      );
      const signalFilter = this.signalFilter.evaluate({
        rsi: Number(indicatorSnapshot?.values.rsi14),
        atr: Number(indicatorSnapshot?.values.atr14),
        volumeChangePercent: Number(indicatorSnapshot?.values.volumeChangePercent),
      });
      if (!signalFilter.allowed) {
        this.logger.log({
          event: "pipeline_signal_filter_skip",
          runId,
          symbol,
          reason: signalFilter.reason,
        });
        await this.repository.updateRun(runId, {
          status: "COMPLETED",
          completedAt: new Date(),
          durationMs: new Date().getTime() - startedAt.getTime(),
          decision: "WAIT",
          confidence: 0,
          dataQuality: "INSUFFICIENT",
          skippedReason: signalFilter.reason,
          result: {
          decision: "WAIT",
          reason: signalFilter.reason,
          actionable: false,
          signalFilter: { allowed: signalFilter.allowed, reason: signalFilter.reason },
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
      const synthesizedOutput = this.decision.decide({
        symbol,
        fusionOutput,
        ...analyses,
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
      await this.finishStep(runId, "decision", output, new Date());
      const filter = this.threshold.evaluate(output);
      const executionDecision = filter.actionable
        ? output
        : { ...output, decision: "WAIT" as const };
      const volatilityAtr = Number(analyses.market?.volatility.atr);
      const riskAssessment = await this.liveTrading.assessPipelineDecision({
        userId: job.userId,
        pipelineRunId: runId,
        symbol,
        provider: job.provider as unknown as ExchangeProvider,
        decision: executionDecision,
        ...(typeof job.params?.strategyId === "string"
          ? { strategyKey: job.params.strategyId }
          : {}),
        ...(Number.isFinite(volatilityAtr) && volatilityAtr >= 0
          ? { volatilityAtr }
          : {}),
      });
      const liveExecution = await this.liveTrading.executePipeline(
        job.userId,
        runId,
      );
      const completedAt = new Date();
      await this.repository.updateRun(runId, {
        status: "COMPLETED",
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        decision: executionDecision.decision,
        confidence: output.confidence,
        dataQuality: output.dataQuality,
        skippedReason: filter.reason,
        storedContext: { analyses, fusionOutput },
        result: {
          ...output,
          actionable: filter.actionable,
          skippedReason: filter.reason,
          riskAssessment,
          liveExecution,
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
      await this.repository.updateRun(runId, {
        status: cancelled ? "CANCELLED" : timedOut ? "TIMEOUT" : "FAILED",
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        errorCode: cancelled
          ? "CANCELLED_BY_USER"
          : timedOut
            ? "PIPELINE_TIMEOUT"
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
