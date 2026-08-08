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

  async checkAndLock(fingerprint: string, ttlSeconds = this.ttlSeconds): Promise<{ locked: boolean; existingRunId?: string; lockToken?: string }> {
    const lockKey = `ai:agent:run-lock:${fingerprint}`;
    const resultKey = `ai:agent:run-result:${fingerprint}`;

    const existingResult = await this.redisService.get(resultKey);
    if (existingResult) {
      return { locked: false, existingRunId: existingResult };
    }

    const lockToken = crypto.randomUUID();
    const acquired = await this.redisService.setNx(lockKey, lockToken, ttlSeconds);
    if (!acquired) return { locked: false };
    return { locked: true, lockToken };
  }

  async setResult(fingerprint: string, runId: string, lockToken?: string, ttlSeconds = this.ttlSeconds): Promise<void> {
    const resultKey = `ai:agent:run-result:${fingerprint}`;
    await this.redisService.setWithTtl(resultKey, runId, ttlSeconds);
    
    await this.unlock(fingerprint, lockToken);
  }

  async unlock(fingerprint: string, lockToken?: string): Promise<void> {
    const lockKey = `ai:agent:run-lock:${fingerprint}`;
    if (lockToken) await this.redisService.compareAndDelete(lockKey, lockToken);
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
