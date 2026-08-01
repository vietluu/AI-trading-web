import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { AgentRunJobPayload } from './agent-run.producer';
import { AgentExecutionService } from '../../application/services/agent-execution.service';
import { AgentInvocationSource, AgentType } from '../../domain/enums';

@Processor('agent-runs')
export class AgentRunProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentRunProcessor.name);

  constructor(private readonly agentExecutionService: AgentExecutionService) {
    super();
  }

  async process(job: Job<AgentRunJobPayload>): Promise<void> {
    this.logger.log(`Starting processing for job ${job.id} (AgentRun: ${job.data.agentRunId})`);

    try {
      await Promise.resolve();
      const {
        agentRunId,
        userId,
        agentType,
        agentVersion,
        inputReference,
        correlationId,
        invocationSource,
      } = job.data;

      this.logger.debug(`Extracted payload fields: ${JSON.stringify({
        agentRunId,
        agentType,
        agentVersion,
        correlationId,
        hasUserId: !!userId,
        hasInputReference: !!inputReference
      })}`);

      const input = JSON.parse(inputReference) as Record<string, unknown>;
      await this.agentExecutionService.executeSync({
        agentType: agentType as AgentType,
        version: agentVersion,
        userId,
        input,
        invocationSource: invocationSource as AgentInvocationSource,
        correlationId,
        existingRunId: agentRunId,
      });

      this.logger.log(`Completed processing for job ${job.id}`);
    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}`, error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }
}
