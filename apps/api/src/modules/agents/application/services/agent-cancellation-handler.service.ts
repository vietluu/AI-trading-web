import { Injectable, Logger } from '@nestjs/common';
import { AgentCancellationService } from '../../infrastructure/redis/agent-cancellation.service';
import { AgentRunRepository } from '../../infrastructure/persistence/agent-run.repository';
import { AgentConcurrencyService } from '../../infrastructure/redis/agent-concurrency.service';
import { AgentStateMachine } from '../../domain/state-machine/agent-state-machine';
import { AgentRunState } from '../../domain/enums';
import { AgentError, AgentErrorCode } from '../../domain/errors/agent-errors';

@Injectable()
export class AgentCancellationHandlerService {
  private readonly logger = new Logger(AgentCancellationHandlerService.name);

  constructor(
    private readonly agentCancellationService: AgentCancellationService,
    private readonly agentRunRepository: AgentRunRepository,
    private readonly agentConcurrencyService: AgentConcurrencyService,
  ) {}

  public async cancelRun(runId: string, userId: string, reason?: string): Promise<boolean> {
    const run = await this.agentRunRepository.findById(runId, userId);
    if (!run) {
      throw new AgentError(
        AgentErrorCode.AGENT_NOT_FOUND,
        `Run ${runId} not found for user`,
        false,
      );
    }

    if (AgentStateMachine.isTerminal(run.status)) {
      return false;
    }

    await this.agentCancellationService.requestCancellation(runId);

    const fromState = run.status;
    const toState = AgentRunState.CANCEL_REQUESTED;

    AgentStateMachine.transition(runId, fromState, toState, reason || 'User requested cancellation', 'AgentCancellationHandlerService');

    await this.agentRunRepository.addTransition({
      runId,
      fromState: fromState,
      toState: toState,
      reason: reason || 'User requested cancellation',
      actor: 'AgentCancellationHandlerService',
    });

    await this.agentRunRepository.updateRun(runId, {
      status: toState,
    });

    this.logger.log({ event: 'agent_run_cancellation_requested', runId, userId, reason });
    return true;
  }

  public async checkCancellation(runId: string): Promise<boolean> {
    return this.agentCancellationService.isCancelled(runId);
  }
}
