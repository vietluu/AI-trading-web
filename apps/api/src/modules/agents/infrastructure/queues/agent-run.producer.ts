import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface AgentRunJobPayload {
  agentRunId: string;
  userId?: string;
  agentType: string;
  agentVersion: number;
  inputReference: string;
  correlationId: string;
  invocationSource: string;
}

@Injectable()
export class AgentRunProducer {
  private readonly logger = new Logger(AgentRunProducer.name);

  constructor(
    @InjectQueue('agent-runs') private readonly queue: Queue,
  ) {}

  async enqueue(payload: AgentRunJobPayload): Promise<string> {
    const job = await this.queue.add('process-agent-run', payload, {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 50,
    });

    this.logger.log(`Enqueued agent run job ${job.id} for run ${payload.agentRunId}`);
    return job.id!;
  }
}
