import { Controller, Sse, Param, UseGuards, MessageEvent, NotFoundException } from '@nestjs/common';
import { Observable, interval } from 'rxjs';
import { map, filter, switchMap, takeWhile, distinctUntilChanged } from 'rxjs/operators';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SessionGuard } from '../../../../session/session.guard';
import { AgentRunRepository } from '../../infrastructure/persistence/agent-run.repository';
import { AgentRunState } from '../../domain/enums';
import { AgentStateMachine } from '../../domain/state-machine/agent-state-machine';

@Controller('agent-runs-sse')
@UseGuards(SessionGuard)
export class AgentSseController {
  constructor(private readonly agentRunRepository: AgentRunRepository) {}

  @Sse(':id/progress')
  public trackProgress(
    @CurrentUser() user: { id: string },
    @Param('id') runId: string,
  ): Observable<MessageEvent> {
    const maxPolls = 150; // 5 minutes (150 * 2 seconds)
    let pollCount = 0;

    return interval(2000).pipe(
      takeWhile(() => pollCount++ < maxPolls),
      switchMap(() => this.agentRunRepository.findById(runId, user.id)),
      filter((run): run is NonNullable<typeof run> => run !== null && run !== undefined),
      distinctUntilChanged((prev, curr) => prev.status === curr.status),
      map((run) => {
        const isTerminal = AgentStateMachine.isTerminal(run.status as AgentRunState);

        return {
          data: {
            runId: run.id,
            status: run.status,
            agentType: run.agentType,
            isTerminal,
            timestamp: new Date().toISOString(),
          },
          type: isTerminal ? 'done' : 'progress',
        } as MessageEvent;
      }),
      takeWhile((event) => event.type !== 'done', true),
    );
  }
}
