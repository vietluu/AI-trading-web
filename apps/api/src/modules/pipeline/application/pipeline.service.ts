import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ExchangeProvider, PipelineTrigger } from '@prisma/client';
import { PipelineRunRequestSchema, PipelineSymbolSchema, type PipelineRunRequest, type PipelineSymbol } from '@platform/shared';
import { PipelineRepository } from '../infrastructure/pipeline.repository';
import { PipelineQueueService } from '../infrastructure/pipeline-queue.service';
import { PipelineConfigService } from './pipeline-config.service';
import { resolvePipelineDefinition } from '../domain/pipeline.definition';
import { pipelineSkipReason } from '../domain/rate-limit';
import { PipelineRunnerService } from './pipeline-runner.service';

@Injectable()
export class PipelineService {
  constructor(
    private readonly repository: PipelineRepository,
    private readonly queue: PipelineQueueService,
    private readonly config: PipelineConfigService,
    @Optional() @Inject(PipelineRunnerService) private readonly runner?: PipelineRunnerService,
  ) {}

  async trigger(userId: string, raw: unknown, trigger: PipelineTrigger = 'MANUAL', options: { replayOfRunId?: string; scheduleId?: string; storedContext?: unknown; useStoredContext?: boolean; maxRunsPerHour?: number } = {}) {
    if (!this.config.enabled) throw new ConflictException('Pipeline automation is disabled');
    const input = PipelineRunRequestSchema.parse(raw);
    const definition = resolvePipelineDefinition(input.pipelineId);
    if (!definition?.enabled) throw new NotFoundException('Pipeline definition not found or disabled');
    const symbols = this.extractSymbols(raw, input.symbol);
    if (symbols.length > 1) {
      const createdRuns = [] as Array<Awaited<ReturnType<PipelineRepository['createRun']>>>;
      const batches = [] as PipelineSymbol[][];
      for (let index = 0; index < symbols.length; index += 3) {
        batches.push(symbols.slice(index, index + 3));
      }
      for (const batch of batches) {
        const batchRuns = await Promise.all(
          batch.map((symbol: PipelineSymbol) =>
            this.createRun(
              userId,
              input,
              definition,
              symbol,
              trigger,
              options,
              input.provider,
              (run) =>
                this.dispatchRun({
                  runId: run.id,
                  userId,
                  pipelineId: input.pipelineId,
                  symbol,
                  provider: input.provider,
                  params: input.params,
                  trigger,
                  createdAt: new Date().toISOString(),
                  useStoredContext: options.useStoredContext,
                }, trigger),
            ),
          ),
        );
        createdRuns.push(...batchRuns);
      }
      return createdRuns;
    }
    return this.createRun(
      userId,
      input,
      definition,
      input.symbol,
      trigger,
      options,
      input.provider,
      async ({ id, symbol }) => {
        await this.dispatchRun(
          {
            runId: id,
            userId,
            pipelineId: input.pipelineId,
            symbol,
            provider: input.provider,
            params: input.params,
            trigger,
            createdAt: new Date().toISOString(),
            useStoredContext: options.useStoredContext,
          },
          trigger,
        );
      },
    );
  }

  private extractSymbols(raw: unknown, fallbackSymbol: PipelineSymbol): PipelineSymbol[] {
    const candidate = raw as { symbols?: unknown; params?: { symbols?: unknown } } | undefined;
    const fromParams = candidate?.params?.symbols;
    const fromRoot = candidate?.symbols;
    const values = Array.isArray(fromParams)
      ? fromParams
      : Array.isArray(fromRoot)
        ? fromRoot
        : [];
    const parsedValues = values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    const parsedSymbols = parsedValues.flatMap((item) => {
      const parsed = PipelineSymbolSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    return parsedSymbols.length > 0 ? parsedSymbols : [fallbackSymbol];
  }

  private async dispatchRun(payload: Parameters<PipelineQueueService['enqueue']>[0], trigger: PipelineTrigger) {
    if (trigger === 'MANUAL' && this.runner) {
      await this.runner.run(payload);
      return;
    }
    try {
      await this.queue.enqueue(payload);
    } catch (error) {
      if (trigger !== 'MANUAL' || !this.runner) throw error;
      await this.runner.run(payload);
    }
  }

  private async createRun(
    userId: string,
    input: Pick<PipelineRunRequest, 'pipelineId' | 'symbol' | 'provider' | 'params'>,
    definition: NonNullable<ReturnType<typeof resolvePipelineDefinition>>,
    symbol: PipelineSymbol,
    trigger: PipelineTrigger,
    options: { replayOfRunId?: string; scheduleId?: string; storedContext?: unknown; useStoredContext?: boolean; maxRunsPerHour?: number },
    provider: ExchangeProvider,
    enqueue: (run: Awaited<ReturnType<PipelineRepository['createRun']>> & { symbol: PipelineSymbol }) => Promise<unknown>,
  ) {
    const id = randomUUID(); const now = new Date(); const traceId = randomUUID(); const correlationId = randomUUID();
    const rawLimit = options.maxRunsPerHour ?? this.config.maxRunsPerHour;
    const hourlyLimit = trigger === 'SCHEDULE' ? Math.max(rawLimit, this.config.maxRunsPerHour) : Math.min(rawLimit, this.config.maxRunsPerHour);
    const [hourlyCount, latest] = await Promise.all([this.repository.countRecent(userId, new Date(Date.now() - 60 * 60_000), { status: { not: 'SKIPPED' } }), this.repository.latestForSymbol(userId, symbol, provider)]);
    const skippedReason = pipelineSkipReason({ hourlyCount, hourlyLimit, latestCreatedAt: latest?.createdAt, now, cooldownMs: this.config.cooldownMs, isScheduled: trigger === 'SCHEDULE', replay: trigger === 'REPLAY' });
    const run = await this.repository.createRun({ id, userId, pipelineId: input.pipelineId, symbol, provider, trigger, params: input.params, traceId, correlationId, replayOfRunId: options.replayOfRunId, scheduleId: options.scheduleId, storedContext: options.storedContext });
    await this.repository.createSteps(id, definition.steps);
    if (skippedReason) {
      await this.repository.updateRun(id, { status: 'SKIPPED', skippedReason, completedAt: now, durationMs: 0, decision: 'WAIT' });
      return run;
    }
    await enqueue({ ...run, symbol });
    return run;
  }

  async replay(userId: string, id: string, mode: 'REPLAY_WITH_STORED_CONTEXT' | 'REPLAY_WITH_LIVE_DATA') {
    const original = await this.repository.findRun(id, userId);
    if (!original) throw new NotFoundException('Pipeline run not found');
    if (mode === 'REPLAY_WITH_STORED_CONTEXT' && !original.storedContext) throw new BadRequestException('Stored context is unavailable for this run');
    return this.trigger(userId, { pipelineId: original.pipelineId, symbol: original.symbol, provider: original.provider, params: original.params ?? {} }, 'REPLAY', { replayOfRunId: original.id, storedContext: mode === 'REPLAY_WITH_STORED_CONTEXT' ? original.storedContext : undefined, useStoredContext: mode === 'REPLAY_WITH_STORED_CONTEXT' });
  }
}
