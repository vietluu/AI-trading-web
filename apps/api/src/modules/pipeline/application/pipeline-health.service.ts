import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { PipelineQueueService } from '../infrastructure/pipeline-queue.service';
import { PipelineSchedulerService } from './pipeline-scheduler.service';

@Injectable()
export class PipelineHealthService {
  constructor(private readonly prisma: PrismaService, private readonly queue: PipelineQueueService, private readonly scheduler: PipelineSchedulerService) {}
  async health() {
    const recent = await this.prisma.pipelineRun.findMany({
      select: { status: true, completedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const lastSuccessfulRun = recent.find((run) => run.status === 'COMPLETED')?.completedAt ?? null;
    let failureStreak = 0; for (const run of recent) { if (!['FAILED', 'TIMEOUT'].includes(run.status)) break; failureStreak++; }
    return { status: failureStreak >= 3 ? 'DEGRADED' : 'HEALTHY', scheduler: this.scheduler.status(), queueDepth: await this.queue.depth(), queuePaused: await this.queue.isPaused(), worker: { healthy: true }, lastSuccessfulRun, failureStreak };
  }
  async metrics() {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const where = { createdAt: { gte: since } };
    const [statuses, decisions, skipped] = await Promise.all([
      this.prisma.pipelineRun.groupBy({ by: ['status'], where, _count: { _all: true }, _avg: { durationMs: true, confidence: true } }),
      this.prisma.pipelineRun.groupBy({ by: ['decision'], where: { ...where, decision: { not: null } }, _count: { _all: true } }),
      this.prisma.pipelineRun.count({ where: { ...where, skippedReason: { not: null } } }),
    ]);
    const count = (status: string) => statuses.find((row) => row.status === status)?._count._all ?? 0;
    const total = statuses.reduce((sum, row) => sum + row._count._all, 0);
    const success = count('COMPLETED');
    const failures = count('FAILED') + count('TIMEOUT');
    const completed = statuses.find((row) => row.status === 'COMPLETED');
    const decisionCount = (decision: string) => decisions.find((row) => row.decision === decision)?._count._all ?? 0;
    return {
      window_hours: 24,
      pipeline_run_total: total,
      pipeline_run_success: success,
      pipeline_run_failure: failures,
      pipeline_duration_ms: completed?._avg.durationMs ?? 0,
      decision_distribution: { LONG: decisionCount('LONG'), SHORT: decisionCount('SHORT'), WAIT: decisionCount('WAIT') },
      average_confidence: completed?._avg.confidence ?? 0,
      skipped_decisions: skipped,
      error_rate: total ? failures / total : 0,
    };
  }
}
