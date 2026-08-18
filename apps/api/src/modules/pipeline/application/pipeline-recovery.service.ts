import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { DistributedTaskLockService } from "../../../redis/distributed-task-lock.service";
import { PipelineQueueService } from "../infrastructure/pipeline-queue.service";
import { PipelineConfigService } from "./pipeline-config.service";

const LIVE_JOB_STATES = new Set(["active"]);
const RETRY_JOB_STATES = new Set([
  "waiting",
  "delayed",
  "prioritized",
  "waiting-children",
]);

@Injectable()
export class PipelineRecoveryService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PipelineRecoveryService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: PipelineQueueService,
    private readonly config: PipelineConfigService,
    private readonly taskLock: DistributedTaskLockService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.CLI_DISABLE_SCHEDULERS === "true") return;
    this.timer = setInterval(
      () => void this.sweep(),
      this.config.recoveryIntervalMs,
    );
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now = new Date()): Promise<{
    inspected: number;
    timedOut: number;
    requeued: number;
    activeStale: number;
  }> {
    const fallback = { inspected: 0, timedOut: 0, requeued: 0, activeStale: 0 };
    return (
      (await this.taskLock.run("pipeline-recovery-sweep", 55, async () => {
        const cutoff = new Date(now.getTime() - this.config.staleRunAfterMs);
        const stale = await this.prisma.pipelineRun.findMany({
          where: { status: "RUNNING", startedAt: { lt: cutoff } },
          select: { id: true, startedAt: true },
          orderBy: { startedAt: "asc" },
          take: 500,
        });
        let timedOut = 0;
        let requeued = 0;
        let activeStale = 0;
        for (const run of stale) {
          let state: string | undefined;
          try {
            state = await this.queue.jobState(run.id);
          } catch (error) {
            this.logger.warn({
              event: "pipeline_recovery_queue_state_unavailable",
              runId: run.id,
              message: error instanceof Error ? error.message : String(error),
            });
            continue;
          }
          if (state && LIVE_JOB_STATES.has(state)) {
            activeStale++;
            continue;
          }
          if (state && RETRY_JOB_STATES.has(state)) {
            const updated = await this.prisma.pipelineRun.updateMany({
              where: { id: run.id, status: "RUNNING" },
              data: {
                status: "QUEUED",
                startedAt: null,
                errorCode: "RETRY_PENDING",
              },
            });
            requeued += updated.count;
            continue;
          }
          const completedAt = now;
          const updated = await this.prisma.pipelineRun.updateMany({
            where: { id: run.id, status: "RUNNING" },
            data: {
              status: "TIMEOUT",
              completedAt,
              durationMs: run.startedAt
                ? Math.max(0, completedAt.getTime() - run.startedAt.getTime())
                : null,
              errorCode: "ORPHANED_PIPELINE_RUN",
              safeErrorMessage:
                "Pipeline worker disappeared before completing the run.",
            },
          });
          timedOut += updated.count;
        }
        const result = {
          inspected: stale.length,
          timedOut,
          requeued,
          activeStale,
        };
        if (stale.length > 0)
          this.logger.warn({ event: "pipeline_recovery_sweep", ...result });
        return result;
      })) ?? fallback
    );
  }
}
