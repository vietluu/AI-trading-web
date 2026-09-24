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
import { RedisService } from '../../../redis/redis.service';
import { ConfluenceCollectorService } from '../infrastructure/confluence-collector.service';

export type ProactiveThesisScheduleInput = {
  userId: string;
  request: unknown;
  scheduleId?: string;
};

export type ProactiveThesisScheduleResult = {
  status: 'SCHEDULED' | 'DUPLICATE' | 'FAILED';
  runId?: string;
  reason?: string;
};

const PROACTIVE_DELIVERY_LEASE_MS = 60_000;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

@Injectable()
export class PipelineService {
  private readonly proactiveThesisDeliveries = new Map<
    string,
    Promise<ProactiveThesisScheduleResult>
  >();

  constructor(
    private readonly repository: PipelineRepository,
    private readonly queue: PipelineQueueService,
    private readonly config: PipelineConfigService,
    @Optional() @Inject(PipelineRunnerService) private readonly runner?: PipelineRunnerService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly confluenceCollector?: ConfluenceCollectorService,
  ) {}

  async scheduleProactiveThesis(
    input: ProactiveThesisScheduleInput,
  ): Promise<ProactiveThesisScheduleResult> {
    const request = PipelineRunRequestSchema.parse(input.request);
    const opportunityId = this.proactiveIdentifier(request.params, 'opportunityId');
    const snapshotId = this.proactiveIdentifier(request.params, 'snapshotId');
    const sourceDataCutoff = this.proactiveIdentifier(request.params, 'sourceDataCutoff');
    const idempotencyKey = `proactive-thesis:${opportunityId}:${snapshotId}`;
    const existing = this.proactiveThesisDeliveries.get(idempotencyKey);
    if (existing) {
      const result = await existing;
      return { status: 'DUPLICATE', runId: result.runId };
    }
    const persistedRun = await this.repository.findProactiveThesisRun(idempotencyKey);
    if (persistedRun) return this.resumeProactiveThesisDelivery(persistedRun, input.userId, request);

    const delivery = this.trigger(
      input.userId,
      request,
      'SCHEDULE',
      {
        scheduleId: input.scheduleId,
        bypassCooldown: true,
        storedContext: {
          opportunityId,
          snapshotId,
          sourceDataCutoff,
          proactiveThesisIdempotencyKey: idempotencyKey,
        },
        proactiveThesisKey: idempotencyKey,
      },
    ).then((run) => {
      if (!run || Array.isArray(run) || typeof run.id !== 'string') {
        throw new Error('PROACTIVE_THESIS_RUN_ID_UNAVAILABLE');
      }
      return { status: 'SCHEDULED' as const, runId: run.id };
    });
    this.proactiveThesisDeliveries.set(idempotencyKey, delivery);

    try {
      return await delivery;
    } catch (error) {
      this.proactiveThesisDeliveries.delete(idempotencyKey);
      if (isPrismaUniqueConflict(error)) {
        const existingRun = await this.repository.findProactiveThesisRun(idempotencyKey);
        if (existingRun) return this.resumeProactiveThesisDelivery(existingRun, input.userId, request);
      }
      throw error;
    }
  }

  async trigger(userId: string, raw: unknown, trigger: PipelineTrigger = 'MANUAL', options: { replayOfRunId?: string; scheduleId?: string; storedContext?: unknown; useStoredContext?: boolean; maxRunsPerHour?: number; bypassCooldown?: boolean; proactiveThesisKey?: string } = {}) {
    if (!this.config.enabled) throw new ConflictException('Pipeline automation is disabled');
    const input = PipelineRunRequestSchema.parse(raw);
    const definition = resolvePipelineDefinition(input.pipelineId);
    if (!definition?.enabled) throw new NotFoundException('Pipeline definition not found or disabled');
    const symbols = this.extractSymbols(raw, PipelineSymbolSchema.parse(input.symbol));
    if (symbols.length > 1) {
      const confluenceBatchId = randomUUID();
      const confluenceBatchExpectedCount = symbols.length;
      if (this.confluenceCollector) {
        await this.confluenceCollector.createBatch(
          confluenceBatchId,
          userId,
          confluenceBatchExpectedCount,
        );
        const timeoutMs = Number(process.env.CONFLUENCE_WINDOW_MS ?? 45000);
        await this.queue.enqueueConfluenceTimeout(
          confluenceBatchId,
          userId,
          timeoutMs,
        );
      }
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
                  confluenceBatchId,
                  confluenceBatchExpectedCount,
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
      symbols[0]!,
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

  private proactiveIdentifier(params: Record<string, unknown>, field: string): string {
    const value = params[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new BadRequestException(`Missing proactive thesis ${field}`);
    }
    return value;
  }

  private async redeliverProactiveThesis(
    runId: string,
    token: string,
    userId: string,
    input: PipelineRunRequest,
  ): Promise<ProactiveThesisScheduleResult> {
    const definition = resolvePipelineDefinition(input.pipelineId);
    if (!definition?.enabled) throw new NotFoundException('Pipeline definition not found or disabled');
    const symbol = PipelineSymbolSchema.parse(input.symbol);
    return this.withProactiveDeliveryLease(runId, token, async (renew) => {
      await this.repository.createSteps(runId, definition.steps);
      await renew();
      await this.dispatchRun({
        runId,
        userId,
        pipelineId: input.pipelineId,
        symbol,
        provider: input.provider,
        params: input.params,
        trigger: 'SCHEDULE',
        createdAt: new Date().toISOString(),
      }, 'SCHEDULE');
      return { status: 'SCHEDULED' as const, runId };
    });
  }

  private async dispatchRun(payload: Parameters<PipelineQueueService['enqueue']>[0], trigger: PipelineTrigger) {
    // Manual and scheduled work share the same backpressure, retries and worker
    // isolation. Running an LLM pipeline inside an HTTP request can pin an API
    // process for up to a minute and bypass queue concurrency limits.
    void trigger;
    await this.queue.enqueue(payload);
  }

  private async createRun(
    userId: string,
    input: Pick<PipelineRunRequest, 'pipelineId' | 'symbol' | 'provider' | 'params'>,
    definition: NonNullable<ReturnType<typeof resolvePipelineDefinition>>,
    symbol: PipelineSymbol,
    trigger: PipelineTrigger,
    options: { replayOfRunId?: string; scheduleId?: string; storedContext?: unknown; useStoredContext?: boolean; maxRunsPerHour?: number; bypassCooldown?: boolean; proactiveThesisKey?: string },
    provider: ExchangeProvider,
    enqueue: (run: Awaited<ReturnType<PipelineRepository['createRun']>> & { symbol: PipelineSymbol }) => Promise<unknown>,
  ) {
    const id = randomUUID(); const now = new Date(); const traceId = randomUUID(); const correlationId = randomUUID();
    const rawLimit = options.maxRunsPerHour ?? this.config.maxRunsPerHour;
    const hourlyLimit = Math.min(rawLimit, this.config.maxRunsPerHour);
    let skippedReason: ReturnType<typeof pipelineSkipReason>;
    if (this.redis && trigger !== 'REPLAY') {
      const hourBucket = now.toISOString().slice(0, 13);
      const quotaKey = `pipeline:quota:${userId}:${hourBucket}`;
      const hourlyCount = await this.redis.incrementWithTtl(quotaKey, 3_700);
      const cooldownSeconds = Math.max(1, Math.ceil(this.config.cooldownMs / 1000));
      const cooldownAcquired = options.bypassCooldown || await this.redis.setNx(
        `pipeline:cooldown:${userId}:${provider}:${symbol}`,
        id,
        cooldownSeconds,
      );
      skippedReason = hourlyCount > hourlyLimit
        ? 'MAX_RUNS_PER_HOUR'
        : cooldownAcquired ? undefined : 'SYMBOL_COOLDOWN_ACTIVE';
      if (skippedReason) await this.redis.decrement(quotaKey);
    } else {
      const [hourlyCount, latest] = await Promise.all([
        this.repository.countRecent(userId, new Date(Date.now() - 60 * 60_000), { status: { not: 'SKIPPED' } }),
        this.repository.latestForSymbol(userId, symbol, provider),
      ]);
      skippedReason = pipelineSkipReason({ hourlyCount, hourlyLimit, latestCreatedAt: options.bypassCooldown ? undefined : latest?.createdAt, now, cooldownMs: this.config.cooldownMs, isScheduled: trigger === 'SCHEDULE', replay: trigger === 'REPLAY' });
    }
    if (options.proactiveThesisKey && skippedReason) {
      throw new Error(`PROACTIVE_THESIS_${skippedReason}`);
    }
    // Compute the initial lease only after quota/cooldown I/O has finished.
    const token = options.proactiveThesisKey ? randomUUID() : undefined;
    const run = await this.repository.createRun({ id, userId, pipelineId: input.pipelineId, symbol, provider, trigger, params: input.params, traceId, correlationId, replayOfRunId: options.replayOfRunId, scheduleId: options.scheduleId, storedContext: options.storedContext, proactiveThesisKey: options.proactiveThesisKey,
      ...(token ? { proactiveDeliveryToken: token, proactiveDeliveryState: 'DELIVERING', proactiveDeliveryLeaseExpiresAt: this.proactiveDeliveryLeaseExpiresAt() } : {}),
    });
    const deliver = async (renew?: () => Promise<void>) => {
      await this.repository.createSteps(run.id, definition.steps);
      if (skippedReason) {
        await this.repository.updateRun(run.id, { status: 'SKIPPED', skippedReason, completedAt: now, durationMs: 0, decision: 'WAIT' });
        if (typeof this.repository.skipOpenSteps === 'function') {
          await this.repository.skipOpenSteps(run.id, skippedReason, now);
        }
        return run;
      }
      await renew?.();
      await enqueue({ ...run, symbol });
      return run;
    };
    return token ? this.withProactiveDeliveryLease(run.id, token, deliver) : deliver();
  }

  private async withProactiveDeliveryLease<T>(
    runId: string,
    token: string,
    deliver: (renew: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    let renewal: Promise<void> | undefined;
    let leaseError: unknown;
    const renew = (): Promise<void> => {
      if (leaseError) return Promise.reject(asError(leaseError));
      if (!renewal) {
        const now = new Date();
        renewal = this.repository.renewProactiveThesisDelivery(
          runId, token, now, this.proactiveDeliveryLeaseExpiresAt(now),
        ).then(({ count }) => {
          if (count !== 1) throw new Error('PROACTIVE_THESIS_DELIVERY_LEASE_LOST');
        }).catch((error: unknown) => {
          leaseError = error;
          throw error;
        }).finally(() => { renewal = undefined; });
      }
      return renewal;
    };
    const heartbeat = setInterval(() => { void renew().catch(() => undefined); }, PROACTIVE_DELIVERY_LEASE_MS / 3);
    heartbeat.unref();
    const stop = async () => {
      clearInterval(heartbeat);
      await renewal?.catch(() => undefined);
    };
    try {
      await renew();
      const result = await deliver(renew);
      await renew();
      await stop();
      const finalized = await this.repository.finalizeProactiveThesisDelivery(runId, token, 'DELIVERED', new Date());
      if (finalized.count !== 1) throw new Error('PROACTIVE_THESIS_DELIVERY_LEASE_LOST');
      return result;
    } catch (error) {
      await stop();
      await this.repository.finalizeProactiveThesisDelivery(runId, token, 'FAILED', new Date());
      throw error;
    } finally {
      await stop();
    }
  }

  private proactiveDeliveryLeaseExpiresAt(now = new Date()) {
    return new Date(now.getTime() + PROACTIVE_DELIVERY_LEASE_MS);
  }

  private async resumeProactiveThesisDelivery(
    persistedRun: Awaited<ReturnType<PipelineRepository['findProactiveThesisRun']>>,
    userId: string,
    request: PipelineRunRequest,
  ): Promise<ProactiveThesisScheduleResult> {
    if (!persistedRun) throw new Error('PROACTIVE_THESIS_RUN_ID_UNAVAILABLE');
    if (persistedRun.proactiveDeliveryState === 'DELIVERED' || persistedRun.proactiveExecutionClaimedAt) {
      return { status: 'DUPLICATE', runId: persistedRun.id };
    }
    const claimedAt = new Date();
    const token = randomUUID();
    const claim = await this.repository.claimProactiveThesisDelivery(
      persistedRun.id,
      claimedAt,
      this.proactiveDeliveryLeaseExpiresAt(claimedAt),
      token,
    );
    // Delivery ownership is an internal lease state. Do not expose it as a
    // fourth public result: callers must treat an active owner as a retryable
    // failed delivery and must not stamp the scheduler cycle healthy.
    if (claim.count === 0) {
      return {
        status: 'FAILED',
        runId: persistedRun.id,
        reason: 'PROACTIVE_THESIS_DELIVERY_IN_PROGRESS',
      };
    }
    return this.redeliverProactiveThesis(persistedRun.id, token, userId, request);
  }

  async replay(userId: string, id: string, mode: 'REPLAY_WITH_STORED_CONTEXT' | 'REPLAY_WITH_LIVE_DATA') {
    const original = await this.repository.findRun(id, userId);
    if (!original) throw new NotFoundException('Pipeline run not found');
    if (mode === 'REPLAY_WITH_STORED_CONTEXT' && !original.storedContext) throw new BadRequestException('Stored context is unavailable for this run');
    return this.trigger(userId, { pipelineId: original.pipelineId, symbol: original.symbol, provider: original.provider, params: original.params ?? {} }, 'REPLAY', { replayOfRunId: original.id, storedContext: mode === 'REPLAY_WITH_STORED_CONTEXT' ? original.storedContext : undefined, useStoredContext: mode === 'REPLAY_WITH_STORED_CONTEXT' });
  }
}

function isPrismaUniqueConflict(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null &&
    'code' in error && (error as { code?: string }).code === 'P2002';
}
