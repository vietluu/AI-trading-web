import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../../../redis/redis.service";
import { SaveMemoryOptions } from "../../domain/models/memory.model";

@Injectable()
export class ShortMemoryService {
  private readonly logger = new Logger(ShortMemoryService.name);

  constructor(private readonly redisService: RedisService) {}

  private getRedisKey(userId: string, memoryKey: string): string {
    return `ai:short_memory:${userId}:${memoryKey}`;
  }

  public async save(options: SaveMemoryOptions): Promise<void> {
    const redisKey = this.getRedisKey(options.userId, options.key);
    const ttl = options.ttlSeconds || 86400; // default 24 hours
    const value = JSON.stringify({
      userId: options.userId,
      sessionId: options.sessionId,
      type: options.type,
      key: options.key,
      content: options.content,
      importance: options.importance ?? 50,
      tags: options.tags || [],
      savedAt: new Date().toISOString(),
    });

    try {
      await this.redisService.setWithTtl(redisKey, value, ttl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to save short memory in Redis: ${msg}`);
    }
  }

  public async load(userId: string, key: string): Promise<Record<string, unknown> | null> {
    const redisKey = this.getRedisKey(userId, key);
    try {
      const data = await this.redisService.get(redisKey);
      if (!data) return null;
      return JSON.parse(data) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to load short memory from Redis: ${msg}`);
      return null;
    }
  }

  public async delete(userId: string, key: string): Promise<void> {
    const redisKey = this.getRedisKey(userId, key);
    try {
      await this.redisService.delete(redisKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to delete short memory from Redis: ${msg}`);
    }
  }
}
