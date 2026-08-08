import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../database/prisma.service";
import { DistributedTaskLockService } from "../../redis/distributed-task-lock.service";

@Injectable()
export class DataRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DataRetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly taskLock?: DistributedTaskLockService,
  ) {}

  onApplicationBootstrap() {
    // Run initial cleanup on startup, then schedule every 12 hours
    void this.runPurge();
    this.timer = setInterval(() => void this.runPurge(), 12 * 60 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async runPurge() {
    if (this.taskLock) {
      await this.taskLock.run('data-retention', 3600, () => this.purgeOldData());
      return;
    }
    await this.purgeOldData();
  }

  async purgeOldData(daysToKeep = 30): Promise<{
    riskAssessments: number;
    snapshots: number;
    agentRuns: number;
    aiHistories: number;
    toolInvocations: number;
    indicatorSnapshots: number;
    contextSnapshots: number;
    expiredMemories: number;
  }> {
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

    try {
      const riskResult = await this.prisma.riskAssessment.deleteMany({
          where: { createdAt: { lt: cutoff } },
        });
      const snapshotResult = await this.prisma.liveAccountSnapshot.deleteMany({
          where: { syncedAt: { lt: cutoff } },
        });
      const agentCutoff = new Date(Date.now() - (this.config?.get<number>('AGENT_RUN_RETENTION_DAYS', 90) ?? 90) * 86_400_000);
      const historyCutoff = new Date(Date.now() - 90 * 86_400_000);
      const indicatorCutoff = new Date(Date.now() - 180 * 86_400_000);
      const agentRuns = await this.prisma.agentRun.deleteMany({ where: { createdAt: { lt: agentCutoff } } });
      const contextSnapshots = await this.prisma.agentContextSnapshot.deleteMany({ where: { createdAt: { lt: agentCutoff }, agentRuns: { none: {} } } });
      const expiredMemories = await this.prisma.aIMemory.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      const aiHistories = await this.prisma.aIHistory.deleteMany({ where: { createdAt: { lt: historyCutoff } } });
      const toolInvocations = await this.prisma.toolInvocationRecord.deleteMany({ where: { createdAt: { lt: historyCutoff } } });
      const indicatorSnapshots = await this.prisma.indicatorSnapshotRecord.deleteMany({ where: { createdAt: { lt: indicatorCutoff } } });

      const totalPurged = riskResult.count + snapshotResult.count;
      if (totalPurged > 0) {
        this.logger.log({
          event: "data_retention_purge_completed",
          daysToKeep,
          cutoff: cutoff.toISOString(),
          purgedRiskAssessments: riskResult.count,
          purgedAccountSnapshots: snapshotResult.count,
        });
      }

      return {
        riskAssessments: riskResult.count,
        snapshots: snapshotResult.count,
        agentRuns: agentRuns.count,
        aiHistories: aiHistories.count,
        toolInvocations: toolInvocations.count,
        indicatorSnapshots: indicatorSnapshots.count,
        contextSnapshots: contextSnapshots.count,
        expiredMemories: expiredMemories.count,
      };
    } catch (err) {
      this.logger.error({
        event: "data_retention_purge_failed",
        error: err instanceof Error ? err.message : String(err),
      });
      return { riskAssessments: 0, snapshots: 0, agentRuns: 0, aiHistories: 0, toolInvocations: 0, indicatorSnapshots: 0, contextSnapshots: 0, expiredMemories: 0 };
    }
  }
}
