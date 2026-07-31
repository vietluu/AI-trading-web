import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  healthResponseSchema,
  type HealthResponse,
  type ServiceHealth,
} from "@platform/shared";

import { PrismaService } from "../database/prisma.service";
import { RedisService } from "../redis/redis.service";

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async getHealth(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      this.measure("database", () => this.prismaService.checkConnection()),
      this.measure("redis", () => this.redisService.checkConnection()),
    ]);

    const health = healthResponseSchema.parse({
      status:
        database.status === "up" && redis.status === "up" ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      services: { database, redis },
    });

    if (health.status === "degraded") {
      throw new ServiceUnavailableException(
        "One or more platform dependencies are unavailable",
      );
    }

    return health;
  }

  private async measure(
    service: string,
    check: () => Promise<void>,
  ): Promise<ServiceHealth> {
    const startedAt = performance.now();

    try {
      await check();
      return {
        status: "up",
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch (error: unknown) {
      this.logger.error({
        event: "health_check_failed",
        service,
        message: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        status: "down",
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }
  }
}
