import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { DecisionRunInputSchema } from '@platform/shared';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SessionGuard } from '../../../../session/session.guard';
import { DecisionService } from '../../application/services/decision.service';
import { AgentInvocationSource } from '../../domain/enums';

@Controller('ai/decision')
@UseGuards(SessionGuard)
export class DecisionController {
  constructor(private readonly decisionService: DecisionService) {}

  @Post()
  public async createDecision(
    @CurrentUser() user: { id: string },
    @Body() body: { input?: Record<string, unknown> },
  ) {
    return this.decisionService.run({
      input: DecisionRunInputSchema.parse(body.input ?? {}),
      userId: user.id,
      invocationSource: AgentInvocationSource.USER_MANUAL,
    });
  }
}
