import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../../redis/redis.service';
import { randomUUID } from 'node:crypto';

@Injectable()
export class AgentConcurrencyService {
  private readonly logger = new Logger(AgentConcurrencyService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async acquireGlobal(): Promise<{ acquired: boolean; current: number; limit: number; token?: string }> {
    const limit = this.configService.get<number>('AGENT_MAX_GLOBAL_CONCURRENCY', 10);
    const key = 'ai:agent:concurrency:global';
    return this.acquire(key, limit);
  }

  async acquireUser(userId: string): Promise<{ acquired: boolean; current: number; limit: number; token?: string }> {
    const limit = this.configService.get<number>('AGENT_MAX_USER_CONCURRENCY', 3);
    const key = `ai:agent:concurrency:user:${userId}`;
    return this.acquire(key, limit);
  }

  async acquireType(agentType: string): Promise<{ acquired: boolean; current: number; limit: number; token?: string }> {
    const limit = this.configService.get<number>('AGENT_MAX_TYPE_CONCURRENCY', 5);
    const key = `ai:agent:concurrency:type:${agentType}`;
    return this.acquire(key, limit);
  }

  async releaseGlobal(token: string): Promise<void> {
    await this.release('ai:agent:concurrency:global', token);
  }

  async releaseUser(userId: string, token: string): Promise<void> {
    await this.release(`ai:agent:concurrency:user:${userId}`, token);
  }

  async releaseType(agentType: string, token: string): Promise<void> {
    await this.release(`ai:agent:concurrency:type:${agentType}`, token);
  }

  private async acquire(key: string, limit: number) {
    const token = randomUUID();
    const result = await this.redisService.acquireSemaphore(key, token, limit, 120_000);
    return { ...result, limit, ...(result.acquired ? { token } : {}) };
  }

  private async release(key: string, token: string): Promise<void> {
    try {
      await this.redisService.releaseSemaphore(key, token);
    } catch (error) {
      this.logger.error(
        `Error safely decrementing concurrency for key ${key}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
