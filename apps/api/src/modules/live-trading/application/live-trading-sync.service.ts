import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { LiveTradingConfigService } from "./live-trading-config.service";
import { LiveTradingService } from "./live-trading.service";

@Injectable()
export class LiveTradingSyncService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LiveTradingSyncService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: LiveTradingConfigService,
    private readonly trading: LiveTradingService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.values.syncEnabled) return;
    this.timer = setInterval(() => void this.syncAll(), this.config.values.syncIntervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async syncAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const connections = await this.prisma.exchangeConnection.findMany({
        where: { isEnabled: true, isVerified: true },
        select: { id: true, userId: true },
      });
      for (const connection of connections) {
        await this.trading.sync(connection.userId, connection.id, {}).catch((error: unknown) =>
          this.logger.error({
            event: "live_state_sync_failed",
            connectionId: connection.id,
            error: error instanceof Error ? error.message.slice(0, 200) : "Unknown sync failure",
          }),
        );
      }
    } finally {
      this.running = false;
    }
  }
}
