import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../../redis/redis.service';

@Injectable()
export class AgentCancellationService {
  private readonly logger = new Logger(AgentCancellationService.name);

  constructor(private readonly redisService: RedisService) {}

  async requestCancellation(runId: string): Promise<void> {
    const key = `ai:agent:cancel:${runId}`;
    await this.redisService.setWithTtl(key, '1', 300);
    this.logger.log(`Cancellation requested for runId: ${runId}`);
  }

  async isCancelled(runId: string): Promise<boolean> {
    const key = `ai:agent:cancel:${runId}`;
    const value = await this.redisService.get(key);
    return !!value;
  }

  async clearCancellation(runId: string): Promise<void> {
    const key = `ai:agent:cancel:${runId}`;
    await this.redisService.delete(key);
    this.logger.log(`Cleared cancellation for runId: ${runId}`);
  }
}
