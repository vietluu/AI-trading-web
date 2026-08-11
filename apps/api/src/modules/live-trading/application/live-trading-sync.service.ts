import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { LiveTradingConfigService } from "./live-trading-config.service";
import { LiveTradingService } from "./live-trading.service";
import { DistributedTaskLockService } from "../../../redis/distributed-task-lock.service";

@Injectable()
export class LiveTradingSyncService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(LiveTradingSyncService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: LiveTradingConfigService,
    private readonly trading: LiveTradingService,
    @Optional() private readonly taskLock?: DistributedTaskLockService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.CLI_DISABLE_SCHEDULERS === 'true') return;
    if (!this.config.values.syncEnabled) return;
    void this.syncAll();
    this.timer = setInterval(
      () => void this.syncAll(),
      this.config.values.syncIntervalMs,
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async syncAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (this.taskLock) {
        await this.taskLock.run('live-trading-sync', Math.max(30, Math.ceil(this.config.values.syncIntervalMs / 1000)), () => this.syncAllConnections());
      } else {
        await this.syncAllConnections();
      }
    } finally {
      this.running = false;
    }
  }

  private async syncAllConnections(): Promise<void> {
      const connections = await this.prisma.exchangeConnection.findMany({
        where: { isEnabled: true, isVerified: true },
        select: { id: true, userId: true },
      });
      const batchSize = 5;
      for (let offset = 0; offset < connections.length; offset += batchSize) {
        const batch = connections.slice(offset, offset + batchSize);
        await Promise.allSettled(
        batch.map((connection) =>
          this.trading
            .sync(connection.userId, connection.id, {})
            .catch((error: unknown) =>
              this.logger.error({
                event: "live_state_sync_failed",
                connectionId: connection.id,
                error:
                  error instanceof Error
                    ? error.message.slice(0, 200)
                    : "Unknown sync failure",
              }),
            ),
        ),
        );
      }
  }
}
