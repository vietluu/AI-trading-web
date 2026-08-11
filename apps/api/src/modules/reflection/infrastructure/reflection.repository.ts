import { Injectable } from '@nestjs/common';
import type { EvaluationHorizon, Prisma, ReflectionCategory, ReflectionSeverity } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class ReflectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  records(userId: string, horizon?: EvaluationHorizon, take = 500, symbol?: string) {
    return this.prisma.performanceRecord.findMany({ where: { userId, ...(horizon ? { horizon } : {}), ...(symbol ? { symbol } : {}) }, orderBy: { evaluatedAt: 'desc' }, take });
  }
  allRecords(take = 5000) { return this.prisma.performanceRecord.findMany({ orderBy: { evaluatedAt: 'desc' }, take }); }
  closedTrades(userId: string, take = 5000) {
    return this.prisma.closedTrade.findMany({ where: { userId }, orderBy: { closedAt: 'desc' }, take });
  }
  completedRuns(cutoff: Date) {
    return this.prisma.pipelineRun.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { lte: cutoff },
        decision: { in: ['LONG', 'SHORT', 'WAIT'] },
        OR: [
          { performanceRecords: { none: { horizon: 'SHORT' } } },
          { performanceRecords: { none: { horizon: 'MID' } } },
          { performanceRecords: { none: { horizon: 'LONG' } } },
        ],
      },
      select: { id: true, userId: true, symbol: true, provider: true, decision: true, confidence: true, marketRegime: true, configurationVersion: true, learningStage: true, completedAt: true, storedContext: true, performanceRecords: { select: { horizon: true } } },
      orderBy: { completedAt: 'asc' },
      take: 1000,
    });
  }
  candleAtOrBefore(provider: 'BINANCE_FUTURES' | 'OKX_FUTURES', symbol: string, at: Date) {
    return this.prisma.marketCandle.findFirst({ where: { provider, symbol, isClosed: true, closeTime: { lte: at } }, orderBy: { closeTime: 'desc' }, select: { close: true } });
  }
  candleAtOrAfter(provider: 'BINANCE_FUTURES' | 'OKX_FUTURES', symbol: string, at: Date) {
    return this.prisma.marketCandle.findFirst({ where: { provider, symbol, isClosed: true, closeTime: { gte: at } }, orderBy: { closeTime: 'asc' }, select: { close: true } });
  }
  createRecord(data: Prisma.PerformanceRecordUncheckedCreateInput) {
    return this.prisma.performanceRecord.upsert({ where: { runId_horizon: { runId: data.runId, horizon: data.horizon } }, create: data, update: {} });
  }
  insights(userId: string) { return this.prisma.reflectionInsight.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }); }
  createInsights(userId: string, rows: Array<{ summary: string; category: ReflectionCategory; severity: ReflectionSeverity }>) {
    return this.prisma.reflectionInsight.createMany({ data: rows.map((row) => ({ userId, ...row })) });
  }
  proposals(userId: string) { return this.prisma.improvementProposal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }); }
  createProposal(userId: string, description: string, proposedChange: string) { return this.prisma.improvementProposal.create({ data: { userId, description, proposedChange } }); }
  reviewProposal(userId: string, id: string, status: 'APPROVED' | 'REJECTED') {
    return this.prisma.improvementProposal.updateMany({ where: { id, userId, status: 'PENDING' }, data: { status, reviewedAt: new Date() } });
  }
  proposal(userId: string, id: string) { return this.prisma.improvementProposal.findFirst({ where: { id, userId } }); }
}
