import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../../redis/redis.service';
import * as crypto from 'crypto';

@Injectable()
export class AgentIdempotencyService {
  private readonly logger = new Logger(AgentIdempotencyService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async checkAndLock(fingerprint: string, ttlSeconds = this.ttlSeconds): Promise<{ locked: boolean; existingRunId?: string }> {
    const lockKey = `ai:agent:run-lock:${fingerprint}`;
    const resultKey = `ai:agent:run-result:${fingerprint}`;

    const existingResult = await this.redisService.get(resultKey);
    if (existingResult) {
      return { locked: false, existingRunId: existingResult };
    }

    const existingLock = await this.redisService.get(lockKey);
    if (existingLock) {
      return { locked: false, existingRunId: existingLock };
    }

    await this.redisService.setWithTtl(lockKey, 'locked', ttlSeconds);
    return { locked: true };
  }

  async setResult(fingerprint: string, runId: string, ttlSeconds = this.ttlSeconds): Promise<void> {
    const resultKey = `ai:agent:run-result:${fingerprint}`;
    await this.redisService.setWithTtl(resultKey, runId, ttlSeconds);
    
    await this.unlock(fingerprint);
  }

  async unlock(fingerprint: string): Promise<void> {
    const lockKey = `ai:agent:run-lock:${fingerprint}`;
    await this.redisService.delete(lockKey);
  }

  private get ttlSeconds(): number {
    return this.configService.get<number>('AGENT_IDEMPOTENCY_TTL_SECONDS', 60);
  }

  calculateFingerprint(params: {
    userId?: string;
    agentType: string;
    agentVersion: number;
    inputHash: string;
    contextHash?: string;
    promptVersion: number;
    modelPolicy?: string;
  }): string {
    const sortedString = JSON.stringify(params, Object.keys(params).sort());
    return crypto.createHash('sha256').update(sortedString).digest('hex');
  }
}
