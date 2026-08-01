import { Injectable, Logger } from '@nestjs/common';
import { AgentRunRepository } from '../../infrastructure/persistence/agent-run.repository';
import { AgentError, AgentErrorCode } from '../../domain/errors/agent-errors';
import { AgentRunState } from '../../domain/enums';
import { AgentStateMachine } from '../../domain/state-machine/agent-state-machine';
import { AgentRun } from '@prisma/client';
import { randomUUID } from 'node:crypto';

@Injectable()
export class AgentReplayService {
  private readonly logger = new Logger(AgentReplayService.name);

  constructor(private readonly agentRunRepository: AgentRunRepository) {}

  public async createReplayRun(params: {
    originalRunId: string;
    userId: string;
    reason?: string;
  }): Promise<{ replayRunId: string; originalRun: AgentRun }> {
    const originalRun = await this.agentRunRepository.findById(params.originalRunId, params.userId);
    if (!originalRun) {
      throw new AgentError(
        AgentErrorCode.AGENT_NOT_FOUND,
        `Original run ${params.originalRunId} not found for user`,
        false,
      );
    }

    if (!AgentStateMachine.isTerminal(originalRun.status as AgentRunState)) {
      throw new AgentError(
        AgentErrorCode.AGENT_STATE_TRANSITION_INVALID,
        `Original run ${params.originalRunId} is not in a terminal state (${originalRun.status})`,
        false,
      );
    }

    const replayRunId = randomUUID();
    const replayRun = await this.agentRunRepository.createRun({
      userId: params.userId,
      agentType: originalRun.agentType as any,
      agentVersion: originalRun.agentVersion,
      invocationSource: 'REPLAY' as any,
      inputHash: originalRun.inputHash,
      sanitizedInput: originalRun.sanitizedInput || undefined,
      promptId: originalRun.promptId,
      promptVersion: originalRun.promptVersion,
      traceId: originalRun.traceId || randomUUID(),
      correlationId: originalRun.correlationId || randomUUID(),
      replayOfRunId: originalRun.id,
    });

    this.logger.log({
      event: 'agent_replay_created',
      replayRunId: replayRun.id,
      originalRunId: originalRun.id,
      userId: params.userId,
      reason: params.reason,
    });

    return { replayRunId: replayRun.id, originalRun };
  }
}
