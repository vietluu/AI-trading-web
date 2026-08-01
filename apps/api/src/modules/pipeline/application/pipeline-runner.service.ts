import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FusionRunInputSchema, type FusionInput, type FusionOutput } from '@platform/shared';
import { AgentInvocationSource } from '../../agents/domain/enums';
import { FusionService } from '../../agents/application/services/fusion.service';
import { DecisionService } from '../../agents/application/services/decision.service';
import { PipelineRepository } from '../infrastructure/pipeline.repository';
import { PipelineCancellationService } from '../infrastructure/pipeline-cancellation.service';
import { PipelineThresholdService } from './pipeline-threshold.service';
import { PipelineAlertService } from './pipeline-alert.service';
import { resolvePipelineDefinition } from '../domain/pipeline.definition';
import type { PipelineJob } from '../infrastructure/pipeline-queue.service';
import { PaperTradingService } from '../../paper-trading/application/paper-trading.service';

class PipelineCancelledError extends Error {}

@Injectable()
export class PipelineRunnerService {
  constructor(private readonly fusion: FusionService, private readonly decision: DecisionService, private readonly repository: PipelineRepository, private readonly cancellation: PipelineCancellationService, private readonly threshold: PipelineThresholdService, private readonly alerts: PipelineAlertService, private readonly paperTrading: PaperTradingService) {}

  async run(job: PipelineJob): Promise<void> {
    const definition = resolvePipelineDefinition(job.pipelineId);
    if (!definition?.enabled) throw new Error('PIPELINE_NOT_FOUND_OR_DISABLED');
    const startedAt = new Date();
    await this.repository.updateRun(job.runId, { status: 'RUNNING', startedAt });
    await this.assertNotCancelled(job.runId);
    try {
      let analyses: FusionInput;
      let fusionOutput: FusionOutput;
      const existing = job.useStoredContext ? await this.repository.findRun(job.runId) : undefined;
      const stored = existing?.storedContext as { analyses?: FusionInput; fusionOutput?: FusionOutput } | null;
      if (stored?.analyses && stored.fusionOutput) {
        analyses = stored.analyses; fusionOutput = stored.fusionOutput;
        for (const step of definition.steps.filter((item) => item.type !== 'DECISION')) await this.completeStep(job.runId, step.id, step.type, step.id === 'fusion' ? fusionOutput : analyses[step.id as keyof FusionInput]);
      } else {
        for (const step of definition.steps.filter((item) => item.type === 'AGENT')) await this.startStep(job.runId, step.id);
        await this.startStep(job.runId, 'fusion');
        const pipelineInput = FusionRunInputSchema.parse({ symbol: job.symbol, provider: job.provider, ...definition.defaultParams, ...job.params });
        const result = await this.withTimeout(this.fusion.runDetailed({ input: pipelineInput, userId: job.userId, invocationSource: this.source(job.trigger), correlationId: job.runId }), definition.timeoutMs);
        analyses = result.analyses; fusionOutput = result.fusionOutput;
        const completedAt = new Date();
        for (const step of definition.steps.filter((item) => item.type === 'AGENT')) await this.finishStep(job.runId, step.id, analyses[step.id as keyof FusionInput], completedAt);
        await this.finishStep(job.runId, 'fusion', fusionOutput, completedAt);
      }
      await this.assertNotCancelled(job.runId);
      await this.startStep(job.runId, 'decision');
      const output = this.decision.decide({ symbol: job.symbol, fusionOutput, ...analyses });
      await this.finishStep(job.runId, 'decision', output, new Date());
      const filter = this.threshold.evaluate(output);
      const executionDecision = filter.actionable ? output : { ...output, decision: 'WAIT' as const };
      const paperExecution = await this.paperTrading.execute({ userId: job.userId, pipelineRunId: job.runId, symbol: job.symbol, provider: job.provider, decision: executionDecision });
      const completedAt = new Date();
      await this.repository.updateRun(job.runId, { status: 'COMPLETED', completedAt, durationMs: completedAt.getTime() - startedAt.getTime(), decision: executionDecision.decision, confidence: output.confidence, dataQuality: output.dataQuality, skippedReason: filter.reason, storedContext: { analyses, fusionOutput }, result: { ...output, actionable: filter.actionable, skippedReason: filter.reason, paperExecution } });
      await this.alerts.contextual(job.runId, job.symbol, analyses);
      if (filter.actionable) await this.alerts.decision(job.runId, job.symbol, output);
    } catch (error) {
      const completedAt = new Date();
      const cancelled = error instanceof PipelineCancelledError;
      const timedOut = error instanceof Error && error.message === 'PIPELINE_TIMEOUT';
      await this.repository.updateRun(job.runId, { status: cancelled ? 'CANCELLED' : timedOut ? 'TIMEOUT' : 'FAILED', completedAt, durationMs: completedAt.getTime() - startedAt.getTime(), errorCode: cancelled ? 'CANCELLED_BY_USER' : timedOut ? 'PIPELINE_TIMEOUT' : 'PIPELINE_EXECUTION_FAILED', safeErrorMessage: error instanceof Error ? error.message.slice(0, 300) : 'Pipeline execution failed' });
      if (cancelled) return;
      await this.alerts.repeatedFailure(job.runId, job.symbol);
      throw error;
    }
  }

  private source(trigger: PipelineJob['trigger']): AgentInvocationSource { return trigger === 'SCHEDULE' ? AgentInvocationSource.FUTURE_SCHEDULED : trigger === 'EVENT' ? AgentInvocationSource.FUTURE_EVENT_DRIVEN : trigger === 'REPLAY' ? AgentInvocationSource.REPLAY : AgentInvocationSource.INTERNAL_SERVICE; }
  private async assertNotCancelled(runId: string) { if (await this.cancellation.isCancelled(runId)) throw new PipelineCancelledError('Pipeline cancelled'); }
  private startStep(runId: string, stepId: string) { return this.repository.updateStep(runId, stepId, { status: 'RUNNING', startedAt: new Date() }); }
  private finishStep(runId: string, stepId: string, output: unknown, completedAt: Date) { return this.repository.updateStep(runId, stepId, { status: 'COMPLETED', completedAt, outputRef: output as Prisma.InputJsonValue }); }
  private async completeStep(runId: string, stepId: string, _type: string, output: unknown) { const now = new Date(); await this.repository.updateStep(runId, stepId, { status: 'COMPLETED', startedAt: now, completedAt: now, durationMs: 0, outputRef: output as Prisma.InputJsonValue }); }
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('PIPELINE_TIMEOUT')), timeoutMs); promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error('Pipeline operation failed')); }); }); }
}
