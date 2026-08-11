import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { PortfolioConfigService } from "./portfolio-config.service";
import { PortfolioService } from "./portfolio.service";
import { DistributedTaskLockService } from "../../../redis/distributed-task-lock.service";

@Injectable()
export class PortfolioRebalanceScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PortfolioRebalanceScheduler.name);
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PortfolioConfigService,
    private readonly portfolio: PortfolioService,
    @Optional() private readonly taskLock?: DistributedTaskLockService,
  ) {}
  onModuleInit() {
    if (process.env.CLI_DISABLE_SCHEDULERS === 'true') return;
    this.timer = setInterval(
      () => void this.run(),
      this.config.values.rebalanceIntervalMs,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async run() {
    if (this.taskLock) {
      await this.taskLock.run('portfolio-rebalance', Math.max(60, Math.ceil(this.config.values.rebalanceIntervalMs / 1000)), () => this.runOnce());
      return;
    }
    await this.runOnce();
  }
  private async runOnce() {
    const owners = await this.prisma.portfolioStrategy.findMany({
      distinct: ["userId"],
      select: { userId: true },
    });
    for (const owner of owners)
      await this.portfolio
        .rebalance(owner.userId, "SCHEDULED")
        .catch((error: unknown) =>
          this.logger.error({
            event: "portfolio_rebalance_failed",
            userId: owner.userId,
            error:
              error instanceof Error
                ? error.message
                : "Unknown rebalance error",
          }),
        );
  }
}
