import { Injectable } from '@nestjs/common';
import { Prisma, type PipelineRunStatus, type PipelineTrigger, type ExchangeProvider } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class PipelineRepository {
  constructor(private readonly prisma: PrismaService) {}

  createRun(data: { id: string; userId: string; pipelineId: string; symbol: string; provider: ExchangeProvider; trigger: PipelineTrigger; params: Record<string, unknown>; traceId: string; correlationId: string; replayOfRunId?: string; scheduleId?: string; storedContext?: unknown }) {
    return this.prisma.pipelineRun.create({ data: { ...data, params: data.params as Prisma.InputJsonValue, storedContext: data.storedContext as Prisma.InputJsonValue | undefined } });
  }
  findRun(id: string, userId?: string) { return this.prisma.pipelineRun.findFirst({ where: { id, ...(userId ? { userId } : {}) }, include: { steps: { orderBy: { createdAt: 'asc' } }, alerts: { orderBy: { createdAt: 'asc' } } } }); }
  listRuns(userId: string, filters: { status?: PipelineRunStatus; page: number; limit: number }) {
    const where = { userId, ...(filters.status ? { status: filters.status } : {}) };
    return Promise.all([this.prisma.pipelineRun.findMany({ where, include: { alerts: true }, orderBy: { createdAt: 'desc' }, skip: (filters.page - 1) * filters.limit, take: filters.limit }), this.prisma.pipelineRun.count({ where })]).then(([data, total]) => ({ data, total, page: filters.page, limit: filters.limit }));
  }
  updateRun(id: string, data: Prisma.PipelineRunUpdateInput) { return this.prisma.pipelineRun.update({ where: { id }, data }); }
  createSteps(runId: string, steps: Array<{ id: string; type: 'AGENT' | 'FUSION' | 'DECISION' }>) { return this.prisma.pipelineStepRun.createMany({ data: steps.map((step) => ({ runId, stepId: step.id, type: step.type })) }); }
  updateStep(runId: string, stepId: string, data: Prisma.PipelineStepRunUpdateInput) { return this.prisma.pipelineStepRun.update({ where: { runId_stepId: { runId, stepId } }, data }); }
  countRecent(userId: string, since: Date, extra: Prisma.PipelineRunWhereInput = {}) { return this.prisma.pipelineRun.count({ where: { userId, createdAt: { gte: since }, ...extra } }); }
  latestForSymbol(userId: string, symbol: string, provider: ExchangeProvider) { return this.prisma.pipelineRun.findFirst({ where: { userId, symbol, provider, status: { in: ['QUEUED', 'RUNNING', 'COMPLETED'] } }, orderBy: { createdAt: 'desc' } }); }
  metrics() { return this.prisma.pipelineRun.findMany({ select: { status: true, durationMs: true, decision: true, confidence: true, completedAt: true }, orderBy: { createdAt: 'desc' }, take: 1000 }); }
}
