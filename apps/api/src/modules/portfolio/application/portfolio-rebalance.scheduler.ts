import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { PortfolioConfigService } from "./portfolio-config.service";
import { PortfolioService } from "./portfolio.service";

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
  ) {}
  onModuleInit() {
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
