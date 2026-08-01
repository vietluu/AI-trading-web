import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PipelineTrigger } from '@prisma/client';
import { PipelineRunRequestSchema } from '@platform/shared';
import { PipelineRepository } from '../infrastructure/pipeline.repository';
import { PipelineQueueService } from '../infrastructure/pipeline-queue.service';
import { PipelineConfigService } from './pipeline-config.service';
import { resolvePipelineDefinition } from '../domain/pipeline.definition';
import { pipelineSkipReason } from '../domain/rate-limit';

@Injectable()
export class PipelineService {
  constructor(private readonly repository: PipelineRepository, private readonly queue: PipelineQueueService, private readonly config: PipelineConfigService) {}

  async trigger(userId: string, raw: unknown, trigger: PipelineTrigger = 'MANUAL', options: { replayOfRunId?: string; scheduleId?: string; storedContext?: unknown; useStoredContext?: boolean; maxRunsPerHour?: number } = {}) {
    if (!this.config.enabled) throw new ConflictException('Pipeline automation is disabled');
    const input = PipelineRunRequestSchema.parse(raw);
    const definition = resolvePipelineDefinition(input.pipelineId);
    if (!definition?.enabled) throw new NotFoundException('Pipeline definition not found or disabled');
    const id = randomUUID(); const now = new Date(); const traceId = randomUUID(); const correlationId = randomUUID();
    const hourlyLimit = Math.min(options.maxRunsPerHour ?? this.config.maxRunsPerHour, this.config.maxRunsPerHour);
    const [hourlyCount, latest] = await Promise.all([this.repository.countRecent(userId, new Date(Date.now() - 60 * 60_000), { status: { not: 'SKIPPED' } }), this.repository.latestForSymbol(userId, input.symbol, input.provider)]);
    const skippedReason = pipelineSkipReason({ hourlyCount, hourlyLimit, latestCreatedAt: latest?.createdAt, now, cooldownMs: this.config.cooldownMs, replay: trigger === 'REPLAY' });
    const run = await this.repository.createRun({ id, userId, pipelineId: input.pipelineId, symbol: input.symbol, provider: input.provider, trigger, params: input.params, traceId, correlationId, replayOfRunId: options.replayOfRunId, scheduleId: options.scheduleId, storedContext: options.storedContext });
    await this.repository.createSteps(id, definition.steps);
    if (skippedReason) return this.repository.updateRun(id, { status: 'SKIPPED', skippedReason, completedAt: now, durationMs: 0, decision: 'WAIT' });
    await this.queue.enqueue({ runId: id, userId, pipelineId: input.pipelineId, symbol: input.symbol, provider: input.provider, params: input.params, trigger, createdAt: now.toISOString(), useStoredContext: options.useStoredContext });
    return run;
  }

  async replay(userId: string, id: string, mode: 'REPLAY_WITH_STORED_CONTEXT' | 'REPLAY_WITH_LIVE_DATA') {
    const original = await this.repository.findRun(id, userId);
    if (!original) throw new NotFoundException('Pipeline run not found');
    if (mode === 'REPLAY_WITH_STORED_CONTEXT' && !original.storedContext) throw new BadRequestException('Stored context is unavailable for this run');
    return this.trigger(userId, { pipelineId: original.pipelineId, symbol: original.symbol, provider: original.provider, params: original.params ?? {} }, 'REPLAY', { replayOfRunId: original.id, storedContext: mode === 'REPLAY_WITH_STORED_CONTEXT' ? original.storedContext : undefined, useStoredContext: mode === 'REPLAY_WITH_STORED_CONTEXT' });
  }
}
