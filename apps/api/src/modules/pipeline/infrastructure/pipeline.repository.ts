import { Injectable } from '@nestjs/common';
import { Prisma, type PipelineRunStatus, type PipelineTrigger, type ExchangeProvider } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  buildEvaluationKey,
  type EvaluationIdentityInput,
} from '../domain/evaluation-identity';

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
  async persistEvaluationIdentity(
    runId: string,
    evaluationKey: string,
    sampleIdentity?: EvaluationIdentityInput,
  ) {
    const run = await this.prisma.pipelineRun.update({
      where: { id: runId },
      data: { evaluationKey },
    });
    const currentSignal = await this.prisma.paperSignal.findFirst({
      where: { pipelineRunId: runId },
    });
    if (!currentSignal) {
      return { run, paperSignal: undefined, sampleReused: false };
    }
    const paperSignalEvaluationKey = sampleIdentity
      ? buildEvaluationKey({
          ...sampleIdentity,
          direction: currentSignal.decision,
          configurationVersion:
            currentSignal.configurationVersion ?? "UNVERSIONED",
        })
      : evaluationKey;

    try {
      const paperSignal = await this.prisma.paperSignal.update({
        where: { id: currentSignal.id },
        data: { evaluationKey: paperSignalEvaluationKey },
      });
      return { run, paperSignal, sampleReused: false };
    } catch (error) {
      if (!isPrismaUniqueConflict(error)) throw error;
      const paperSignal = await this.prisma.paperSignal.findFirst({
        where: { evaluationKey: paperSignalEvaluationKey },
      });
      if (!paperSignal) throw error;
      if (paperSignal.id !== currentSignal.id) {
        await this.prisma.paperSignal.delete({ where: { id: currentSignal.id } });
      }
      return { run, paperSignal, sampleReused: true };
    }
  }
  createSteps(runId: string, steps: Array<{ id: string; type: 'AGENT' | 'FUSION' | 'DECISION' }>) { return this.prisma.pipelineStepRun.createMany({ data: steps.map((step) => ({ runId, stepId: step.id, type: step.type })) }); }
  updateStep(runId: string, stepId: string, data: Prisma.PipelineStepRunUpdateInput) { return this.prisma.pipelineStepRun.update({ where: { runId_stepId: { runId, stepId } }, data }); }
  countRecent(userId: string, since: Date, extra: Prisma.PipelineRunWhereInput = {}) { return this.prisma.pipelineRun.count({ where: { userId, createdAt: { gte: since }, ...extra } }); }
  latestForSymbol(userId: string, symbol: string, provider: ExchangeProvider) { return this.prisma.pipelineRun.findFirst({ where: { userId, symbol, provider, status: { in: ['QUEUED', 'RUNNING', 'COMPLETED'] } }, orderBy: { createdAt: 'desc' } }); }
  async activeStrategyKeys(userId: string, requestedKeys: string[]): Promise<string[]> {
    if (!requestedKeys.length) return [];
    const strategies = await this.prisma.portfolioStrategy.findMany({
      where: {
        userId,
        key: { in: requestedKeys },
        status: 'ACTIVE',
      },
      select: { key: true },
    });
    const eligible = new Set(strategies.map((strategy) => strategy.key));
    return requestedKeys.filter((key) => eligible.has(key));
  }
  async createPaperSignals(data: Array<{
    id: string;
    userId: string;
    pipelineRunId?: string;
    evaluationKey?: string;
    symbol: string;
    provider?: ExchangeProvider;
    decision: string;
    confidence: number;
    mode: string;
    configurationVersion?: number;
    referencePrice: Prisma.Decimal | number;
    outcome: string;
    marketRegime?: string;
  }>) {
    return Promise.all(data.map(async (record) => {
      try {
        return await this.prisma.paperSignal.create({ data: record });
      } catch (error) {
        if (!isPrismaUniqueConflict(error)) throw error;
        if (!record.evaluationKey && !record.pipelineRunId) throw error;
        const existing = await this.prisma.paperSignal.findFirst({
          where: record.evaluationKey
            ? {
                OR: [
                  { evaluationKey: record.evaluationKey },
                  ...(record.pipelineRunId
                    ? [{ pipelineRunId: record.pipelineRunId }]
                    : []),
                ],
              }
            : { pipelineRunId: record.pipelineRunId },
        });
        if (!existing) throw error;
        return existing;
      }
    }));
  }
  metrics() { return this.prisma.pipelineRun.findMany({ select: { status: true, durationMs: true, decision: true, confidence: true, completedAt: true }, orderBy: { createdAt: 'desc' }, take: 1000 }); }
}

function isPrismaUniqueConflict(error: unknown): error is { code: "P2002" } {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "P2002";
}
