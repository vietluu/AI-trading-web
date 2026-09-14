import { Injectable } from "@nestjs/common";
import type {
  EvaluationHorizon,
  Prisma,
  ReflectionCategory,
  ReflectionSeverity,
} from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class ReflectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  records(
    userId: string,
    horizon?: EvaluationHorizon,
    take = 500,
    symbol?: string,
    provenanceOnly?: boolean,
  ) {
    return this.prisma.performanceRecord.findMany({
      where: {
        userId,
        ...(horizon ? { horizon } : {}),
        ...(symbol ? { symbol } : {}),
        ...(provenanceOnly ? { provenanceEligible: true } : {}),
      },
      orderBy: { evaluatedAt: "desc" },
      take,
    });
  }
  allRecords(take = 5000) {
    return this.prisma.performanceRecord.findMany({
      orderBy: { evaluatedAt: "desc" },
      take,
    });
  }
  closedTrades(userId: string, take = 5000) {
    return this.prisma.closedTrade.findMany({
      where: { userId },
      orderBy: { closedAt: "desc" },
      take,
    });
  }
  lifecycleOutcomes(symbol?: string, take = 500) {
    return this.prisma.tradeLifecycleOutcome.findMany({
      where: {
        status: "FINALIZED",
        ...(symbol ? { symbol } : {}),
      },
      orderBy: { closedAt: "desc" },
      take,
    });
  }
  completedRuns(
    cutoff: Date,
    cursor?: { completedAt: Date; id: string },
    take = 1000,
  ) {
    return this.prisma.pipelineRun.findMany({
      where: {
        status: "COMPLETED",
        completedAt: { lte: cutoff },
        decision: { in: ["LONG", "SHORT", "WAIT"] },
        ...(cursor
          ? {
              AND: [
                {
                  OR: [
                    { completedAt: { gt: cursor.completedAt } },
                    { completedAt: cursor.completedAt, id: { gt: cursor.id } },
                  ],
                },
              ],
            }
          : {}),
        OR: [
          { performanceRecords: { none: { horizon: "M15" } } },
          { performanceRecords: { none: { horizon: "M30" } } },
          { performanceRecords: { none: { horizon: "SHORT" } } },
          { performanceRecords: { none: { horizon: "H2" } } },
          { performanceRecords: { none: { horizon: "H4" } } },
          { performanceRecords: { none: { horizon: "MID" } } },
          { performanceRecords: { none: { horizon: "LONG" } } },
        ],
      },
      select: {
        id: true,
        evaluationKey: true,
        userId: true,
        symbol: true,
        provider: true,
        decision: true,
        confidence: true,
        marketRegime: true,
        configurationVersion: true,
        learningStage: true,
        timeframe: true,
        completedAt: true,
        storedContext: true,
        result: true,
        performanceRecords: { select: { horizon: true } },
      },
      orderBy: [{ completedAt: "asc" }, { id: "asc" }],
      take,
    });
  }
  async evaluationSampleClaimed(
    evaluationKey: string,
    runId: string,
  ): Promise<boolean> {
    const [labeledRun, eligibleOwner] = await Promise.all([
      this.prisma.pipelineRun.findFirst({
        where: {
          evaluationKey,
          performanceRecords: { some: {} },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      }),
      this.prisma.pipelineRun.findFirst({
        where: {
          evaluationKey,
          status: "COMPLETED",
          completedAt: { not: null },
          decision: { in: ["LONG", "SHORT", "WAIT"] },
          confidence: { not: null },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      }),
    ]);
    const owner = labeledRun ?? eligibleOwner;
    return owner !== null && owner.id !== runId;
  }
  candleAtOrBefore(
    provider: "BINANCE_FUTURES" | "OKX_FUTURES",
    symbol: string,
    at: Date,
    toleranceMs: number,
  ) {
    return this.prisma.marketCandle.findFirst({
      where: {
        provider,
        symbol,
        isClosed: true,
        closeTime: {
          gte: new Date(at.getTime() - toleranceMs),
          lte: at,
        },
      },
      orderBy: { closeTime: "desc" },
      select: { close: true, closeTime: true },
    });
  }
  async candleAtOrAfter(
    provider: "BINANCE_FUTURES" | "OKX_FUTURES",
    symbol: string,
    at: Date,
    toleranceMs: number,
  ) {
    const common = { provider, symbol, isClosed: true } as const;
    const [before, after] = await Promise.all([
      this.prisma.marketCandle.findFirst({
        where: {
          ...common,
          closeTime: {
            gte: new Date(at.getTime() - toleranceMs),
            lte: at,
          },
        },
        orderBy: { closeTime: "desc" },
        select: { close: true, closeTime: true },
      }),
      this.prisma.marketCandle.findFirst({
        where: {
          ...common,
          closeTime: {
            gte: at,
            lte: new Date(at.getTime() + toleranceMs),
          },
        },
        orderBy: { closeTime: "asc" },
        select: { close: true, closeTime: true },
      }),
    ]);
    if (!before) return after;
    if (!after) return before;
    return at.getTime() - before.closeTime.getTime() <=
      after.closeTime.getTime() - at.getTime()
      ? before
      : after;
  }
  createRecord(data: Prisma.PerformanceRecordUncheckedCreateInput) {
    if (data.evaluationKey) {
      return this.prisma.performanceRecord.create({ data }).catch(async (error: unknown) => {
        if (!isPrismaUniqueConflict(error)) throw error;
        const existing = await this.prisma.performanceRecord.findFirst({
          where: { evaluationKey: data.evaluationKey, horizon: data.horizon },
        });
        if (existing) return existing;
        throw error;
      });
    }
    return this.prisma.performanceRecord.upsert({
      where: { runId_horizon: { runId: data.runId, horizon: data.horizon } },
      create: data,
      update: {},
    });
  }
  insights(userId: string) {
    return this.prisma.reflectionInsight.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  createInsights(
    userId: string,
    rows: Array<{
      summary: string;
      category: ReflectionCategory;
      severity: ReflectionSeverity;
    }>,
  ) {
    return this.prisma.reflectionInsight.createMany({
      data: rows.map((row) => ({ userId, ...row })),
    });
  }
  proposals(userId: string) {
    return this.prisma.improvementProposal.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }
  createProposal(userId: string, description: string, proposedChange: string) {
    return this.prisma.improvementProposal.create({
      data: { userId, description, proposedChange },
    });
  }
  reviewProposal(userId: string, id: string, status: "APPROVED" | "REJECTED") {
    return this.prisma.improvementProposal.updateMany({
      where: { id, userId, status: "PENDING" },
      data: { status, reviewedAt: new Date() },
    });
  }
  proposal(userId: string, id: string) {
    return this.prisma.improvementProposal.findFirst({ where: { id, userId } });
  }

  async recoveryCohortOutcomes(cohortKey?: string, take = 5000) {
    const shadowPlans = await this.prisma.shadowExecutionPlan.findMany({
      where: {
        status: { in: ['TARGET_REACHED', 'STOPPED', 'EXPIRED', 'FILLED', 'CANCELLED'] },
        ...(cohortKey ? { cohortKey } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    const controlOutcomes = await this.prisma.tradeLifecycleOutcome.findMany({
      where: {
        status: 'FINALIZED',
        ...(cohortKey ? { symbol: cohortKey.split(':')[1] } : {}),
      },
      orderBy: { closedAt: 'desc' },
      take,
    });

    return { shadowPlans, controlOutcomes };
  }
}

function isPrismaUniqueConflict(error: unknown): error is { code: "P2002" } {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "P2002";
}
