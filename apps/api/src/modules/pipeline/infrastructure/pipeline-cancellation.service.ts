import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RedisService } from '../../../redis/redis.service';
import { PipelineRepository } from './pipeline.repository';

@Injectable()
export class PipelineCancellationService {
  constructor(@InjectQueue('pipeline:run') private readonly queue: Queue, private readonly redis: RedisService, private readonly repository: PipelineRepository) {}
  async request(runId: string, userId: string): Promise<boolean> {
    const run = await this.repository.findRun(runId, userId);
    if (!run || ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'SKIPPED'].includes(run.status)) return false;
    await this.redis.setWithTtl(`pipeline:cancel:${runId}`, '1', 600);
    await this.repository.updateRun(runId, { cancellationRequestedAt: new Date() });
    const job = await this.queue.getJob(runId);
    if (job && (await job.getState()) === 'waiting') {
      await job.remove();
      await this.repository.updateRun(runId, { status: 'CANCELLED', completedAt: new Date(), errorCode: 'CANCELLED_BY_USER' });
    }
    return true;
  }
  async isCancelled(runId: string): Promise<boolean> { return (await this.redis.get(`pipeline:cancel:${runId}`)) === '1'; }
}
