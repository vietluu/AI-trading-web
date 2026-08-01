import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../../redis/redis.service';

@Injectable()
export class AgentConcurrencyService {
  private readonly logger = new Logger(AgentConcurrencyService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async acquireGlobal(): Promise<{ acquired: boolean; current: number; limit: number }> {
    const limit = this.configService.get<number>('AGENT_MAX_GLOBAL_CONCURRENCY', 10);
    const key = 'ai:agent:concurrency:global';
    const current = await this.redisService.incrementWithTtl(key, 120);
    
    if (current > limit) {
      await this.decrementSafe(key);
      return { acquired: false, current: current - 1, limit };
    }
    
    return { acquired: true, current, limit };
  }

  async acquireUser(userId: string): Promise<{ acquired: boolean; current: number; limit: number }> {
    const limit = this.configService.get<number>('AGENT_MAX_USER_CONCURRENCY', 3);
    const key = `ai:agent:concurrency:user:${userId}`;
    const current = await this.redisService.incrementWithTtl(key, 120);
    
    if (current > limit) {
      await this.decrementSafe(key);
      return { acquired: false, current: current - 1, limit };
    }
    
    return { acquired: true, current, limit };
  }

  async acquireType(agentType: string): Promise<{ acquired: boolean; current: number; limit: number }> {
    const limit = this.configService.get<number>('AGENT_MAX_TYPE_CONCURRENCY', 5);
    const key = `ai:agent:concurrency:type:${agentType}`;
    const current = await this.redisService.incrementWithTtl(key, 120);
    
    if (current > limit) {
      await this.decrementSafe(key);
      return { acquired: false, current: current - 1, limit };
    }
    
    return { acquired: true, current, limit };
  }

  async releaseGlobal(): Promise<void> {
    await this.decrementSafe('ai:agent:concurrency:global');
  }

  async releaseUser(userId: string): Promise<void> {
    await this.decrementSafe(`ai:agent:concurrency:user:${userId}`);
  }

  async releaseType(agentType: string): Promise<void> {
    await this.decrementSafe(`ai:agent:concurrency:type:${agentType}`);
  }

  private async decrementSafe(key: string): Promise<void> {
    try {
      const val = await this.redisService.get(key);
      if (val) {
        const current = parseInt(val, 10);
        if (current > 1) {
          await this.redisService.setWithTtl(key, (current - 1).toString(), 120);
        } else {
          await this.redisService.delete(key);
        }
      }
    } catch (error) {
      this.logger.error(`Error safely decrementing concurrency for key ${key}`, error instanceof Error ? error.stack : String(error));
    }
  }
}
