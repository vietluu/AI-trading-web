import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../../../redis/redis.service";

@Injectable()
export class ToolRateLimiterService {
  private readonly logger = new Logger(ToolRateLimiterService.name);

  constructor(private readonly redisService: RedisService) {}

  public async checkUserRateLimit(userId: string, limitPerMinute = 30): Promise<{ allowed: boolean; remaining: number }> {
    const windowKey = new Date().toISOString().slice(0, 16); // Minute window YYYY-MM-DDTHH:mm
    const key = `ai:tool:rate:user:${userId}:${windowKey}`;

    try {
      const current = await this.redisService.incrementWithTtl(key, 60);
      if (current > limitPerMinute) {
        return { allowed: false, remaining: 0 };
      }
      return { allowed: true, remaining: limitPerMinute - current };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to check user rate limit in Redis: ${msg}`);
      return { allowed: true, remaining: 1 };
    }
  }
}
