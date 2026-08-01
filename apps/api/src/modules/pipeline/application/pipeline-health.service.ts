import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { PipelineQueueService } from '../infrastructure/pipeline-queue.service';
import { PipelineSchedulerService } from './pipeline-scheduler.service';

@Injectable()
export class PipelineHealthService {
  constructor(private readonly prisma: PrismaService, private readonly queue: PipelineQueueService, private readonly scheduler: PipelineSchedulerService) {}
  async health() {
    const recent = await this.prisma.pipelineRun.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const lastSuccessfulRun = recent.find((run) => run.status === 'COMPLETED')?.completedAt ?? null;
    let failureStreak = 0; for (const run of recent) { if (!['FAILED', 'TIMEOUT'].includes(run.status)) break; failureStreak++; }
    return { status: failureStreak >= 3 ? 'DEGRADED' : 'HEALTHY', scheduler: this.scheduler.status(), queueDepth: await this.queue.depth(), queuePaused: await this.queue.isPaused(), worker: { healthy: true }, lastSuccessfulRun, failureStreak };
  }
  async metrics() {
    const rows = await this.prisma.pipelineRun.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 });
    const completed = rows.filter((row) => row.status === 'COMPLETED'); const failures = rows.filter((row) => ['FAILED', 'TIMEOUT'].includes(row.status));
    const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    return { pipeline_run_total: rows.length, pipeline_run_success: completed.length, pipeline_run_failure: failures.length, pipeline_duration_ms: average(completed.flatMap((row) => row.durationMs ?? [])), decision_distribution: { LONG: rows.filter((r) => r.decision === 'LONG').length, SHORT: rows.filter((r) => r.decision === 'SHORT').length, WAIT: rows.filter((r) => r.decision === 'WAIT').length }, average_confidence: average(completed.flatMap((row) => row.confidence ?? [])), skipped_decisions: rows.filter((r) => !!r.skippedReason).length, error_rate: rows.length ? failures.length / rows.length : 0 };
  }
}
