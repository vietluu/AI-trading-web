import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../../../redis/redis.service";
import type { ToolResult } from "../../domain/contracts/tool-result.contract";

@Injectable()
export class ToolIdempotencyService {
  private readonly logger = new Logger(ToolIdempotencyService.name);

  constructor(private readonly redisService: RedisService) {}

  public async getCachedResult(fingerprint: string): Promise<ToolResult | null> {
    const key = `ai:tool:result:${fingerprint}`;
    try {
      const data = await this.redisService.get(key);
      if (!data) return null;
      return JSON.parse(data) as ToolResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to get cached tool result from Redis: ${msg}`);
      return null;
    }
  }

  public async setCachedResult(fingerprint: string, result: ToolResult, ttlSeconds = 10): Promise<void> {
    const key = `ai:tool:result:${fingerprint}`;
    try {
      await this.redisService.setWithTtl(key, JSON.stringify(result), ttlSeconds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to set cached tool result in Redis: ${msg}`);
    }
  }
}
