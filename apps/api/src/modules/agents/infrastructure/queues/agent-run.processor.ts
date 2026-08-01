import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { AgentRunJobPayload } from './agent-run.producer';

@Processor('agent-runs')
export class AgentRunProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentRunProcessor.name);

  constructor() {
    super();
    // AgentExecutionService will be injected here later
  }

  async process(job: Job<AgentRunJobPayload>): Promise<void> {
    this.logger.log(`Starting processing for job ${job.id} (AgentRun: ${job.data.agentRunId})`);
    
    try {
      const {
        agentRunId,
        userId,
        agentType,
        agentVersion,
        inputReference,
        correlationId
      } = job.data;

      this.logger.debug(`Extracted payload fields: ${JSON.stringify({
        agentRunId,
        agentType,
        agentVersion,
        correlationId,
        hasUserId: !!userId,
        hasInputReference: !!inputReference
      })}`);

      // TODO: Call AgentExecutionService.executeRun(agentRunId) in Group 3

      this.logger.log(`Completed processing for job ${job.id}`);
    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}`, error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }
}
