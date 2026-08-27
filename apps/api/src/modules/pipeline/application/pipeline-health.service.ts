import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { PipelineQueueService } from "../infrastructure/pipeline-queue.service";
import { PipelineSchedulerService } from "./pipeline-scheduler.service";
import { PipelineConfigService } from "./pipeline-config.service";

@Injectable()
export class PipelineHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: PipelineQueueService,
    private readonly scheduler: PipelineSchedulerService,
    private readonly config: PipelineConfigService,
  ) {}
  async health() {
    const [recent, staleRunningRuns, staleQueuedRuns] = await Promise.all([
      this.prisma.pipelineRun.findMany({
        select: { status: true, completedAt: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.prisma.pipelineRun.count({
        where: {
          status: "RUNNING",
          startedAt: { lt: new Date(Date.now() - this.config.staleRunAfterMs) },
        },
      }),
      this.prisma.pipelineRun.count({
        where: {
          status: "QUEUED",
          createdAt: { lt: new Date(Date.now() - this.config.staleRunAfterMs) },
        },
      }),
    ]);
    const lastSuccessfulRun =
      recent.find((run) => run.status === "COMPLETED")?.completedAt ?? null;
    let failureStreak = 0;
    for (const run of recent) {
      if (!["FAILED", "TIMEOUT"].includes(run.status)) break;
      failureStreak++;
    }
    return {
      status:
        failureStreak >= 3 || staleRunningRuns > 0 || staleQueuedRuns > 0
          ? "DEGRADED"
          : "HEALTHY",
      scheduler: this.scheduler.status(),
      queueDepth: await this.queue.depth(),
      queuePaused: await this.queue.isPaused(),
      worker: {
        healthy: staleRunningRuns === 0 && staleQueuedRuns === 0,
        staleRunningRuns,
        staleQueuedRuns,
      },
      lastSuccessfulRun,
      failureStreak,
    };
  }
  async metrics() {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const where = { createdAt: { gte: since } };
    const [statuses, decisions, skipped, funnelRuns, riskAssessed, riskApproved, liveOrders] = await Promise.all([
      this.prisma.pipelineRun.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
        _avg: { durationMs: true, confidence: true },
      }),
      this.prisma.pipelineRun.groupBy({
        by: ["decision"],
        where: { ...where, decision: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.pipelineRun.count({
        where: { ...where, skippedReason: { not: null } },
      }),
      this.prisma.pipelineRun.findMany({
        where,
        select: { result: true, skippedReason: true },
        orderBy: { createdAt: "desc" },
        take: 5_000,
      }),
      this.prisma.riskAssessment.count({ where }),
      this.prisma.riskAssessment.count({ where: { ...where, approved: true } }),
      this.prisma.liveOrder.count({ where }),
    ]);
    const count = (status: string) =>
      statuses.find((row) => row.status === status)?._count._all ?? 0;
    const total = statuses.reduce((sum, row) => sum + row._count._all, 0);
    const success = count("COMPLETED");
    const failures = count("FAILED") + count("TIMEOUT");
    const completed = statuses.find((row) => row.status === "COMPLETED");
    const decisionCount = (decision: string) =>
      decisions.find((row) => row.decision === decision)?._count._all ?? 0;
    const resultOf = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const directionalCandidates = funnelRuns.filter((run) => {
      const candidate = resultOf(resultOf(run.result).candidateDecision);
      return candidate.decision === "LONG" || candidate.decision === "SHORT";
    }).length;
    const judgePassed = funnelRuns.filter((run) =>
      resultOf(resultOf(run.result).judge).approved === true,
    ).length;
    const quantPassed = funnelRuns.filter((run) =>
      resultOf(resultOf(run.result).quant).allowed === true,
    ).length;
    const rejectionCounts = new Map<string, number>();
    for (const run of funnelRuns) {
      if (!run.skippedReason) continue;
      rejectionCounts.set(
        run.skippedReason,
        (rejectionCounts.get(run.skippedReason) ?? 0) + 1,
      );
    }
    return {
      window_hours: 24,
      pipeline_run_total: total,
      pipeline_run_success: success,
      pipeline_run_failure: failures,
      pipeline_duration_ms: completed?._avg.durationMs ?? 0,
      decision_distribution: {
        LONG: decisionCount("LONG"),
        SHORT: decisionCount("SHORT"),
        WAIT: decisionCount("WAIT"),
      },
      average_confidence: completed?._avg.confidence ?? 0,
      skipped_decisions: skipped,
      execution_funnel: {
        runs: funnelRuns.length,
        directional_candidates: directionalCandidates,
        judge_passed: judgePassed,
        quant_passed: quantPassed,
        risk_assessed: riskAssessed,
        risk_approved: riskApproved,
        live_orders: liveOrders,
      },
      top_blocking_reasons: [...rejectionCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10)
        .map(([reason, count]) => ({ reason, count })),
      error_rate: total ? failures / total : 0,
    };
  }
}
