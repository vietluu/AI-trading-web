import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { DistributedTaskLockService } from '../../../redis/distributed-task-lock.service';
import { QuantIntelligenceService } from './quant-intelligence.service';

const REFRESH_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class QuantResearchSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QuantResearchSchedulerService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly quant: QuantIntelligenceService,
    @Optional() private readonly taskLock?: DistributedTaskLockService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.CLI_DISABLE_SCHEDULERS === 'true') return;
    this.timer = setInterval(() => void this.sweep(), REFRESH_INTERVAL_MS);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    if (this.taskLock) {
      await this.taskLock.run('quant-research-refresh', 240, () => this.sweepOnce());
      return;
    }
    await this.sweepOnce();
  }

  private async sweepOnce(): Promise<void> {
    const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const [settingsUsers, pipelineUsers] = await Promise.all([
      this.prisma.userSetting.findMany({
        where: { preferredSymbols: { isEmpty: false } },
        select: { userId: true },
      }),
      this.prisma.pipelineRun.findMany({
        where: { createdAt: { gte: recentCutoff } },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);
    const userIds = [...new Set([...settingsUsers, ...pipelineUsers].map((item) => item.userId))];
    let symbols = 0;
    let unavailable = 0;
    for (const userId of userIds) {
      try {
        const result = await this.quant.generateSelectedHypotheses(userId);
        symbols += result.symbols.length;
        unavailable += result.hypotheses.filter((item) => item.status === 'DATA_UNAVAILABLE').length;
      } catch (error) {
        this.logger.warn({ event: 'quant_research_user_refresh_failed', userId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    this.logger.log({ event: 'quant_research_refresh_completed', users: userIds.length, symbols, unavailable });
  }
}
