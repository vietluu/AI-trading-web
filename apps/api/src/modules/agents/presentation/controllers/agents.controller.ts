import { Controller, Get, Post, Param, Body, Query, UseGuards, NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SessionGuard } from '../../../../session/session.guard';
import { AgentRegistryService } from '../../infrastructure/registry/agent-registry.service';
import { AgentExecutionService } from '../../application/services/agent-execution.service';
import { AgentRunRepository } from '../../infrastructure/persistence/agent-run.repository';
import { AgentHealthService } from '../../application/services/agent-health.service';
import { AgentContextSnapshotRepository } from '../../infrastructure/persistence/agent-context-snapshot.repository';
import { AgentReplayService } from '../../application/services/agent-replay.service';
import { AgentCancellationHandlerService } from '../../application/services/agent-cancellation-handler.service';
import { AgentType, AgentInvocationSource } from '../../domain/enums';
import { FusionRunInputSchema } from '@platform/shared';
import { FusionService } from '../../application/services/fusion.service';

@Controller(['agents', 'ai/agents'])
@UseGuards(SessionGuard)
export class AgentsController {
  constructor(
    private readonly agentRegistryService: AgentRegistryService,
    private readonly agentExecutionService: AgentExecutionService,
    private readonly agentRunRepository: AgentRunRepository,
    private readonly agentHealthService: AgentHealthService,
    private readonly agentContextSnapshotRepository: AgentContextSnapshotRepository,
    private readonly agentReplayService: AgentReplayService,
    private readonly agentCancellationHandlerService: AgentCancellationHandlerService,
    private readonly fusionService: FusionService,
  ) {}

  @Post('fusion/run')
  public async runFusion(
    @CurrentUser() user: { id: string },
    @Body() body: { input: Record<string, unknown> },
  ) {
    return this.fusionService.run({
      input: FusionRunInputSchema.parse(body.input || {}),
      userId: user.id,
      invocationSource: AgentInvocationSource.USER_MANUAL,
    });
  }

  @Get()
  public getAgents() {
    return this.agentRegistryService.listActive().map((def) => ({
      type: def.type,
      version: def.version,
      displayName: def.displayName,
      description: def.description,
      status: def.status,
      executionMode: def.executionMode,
      promptId: def.promptId,
      promptVersion: def.promptVersion,
      allowedToolNames: def.allowedToolNames,
      requiredCapabilities: def.requiredCapabilities,
    }));
  }

  @Get('health')
  public async getHealth() {
    return this.agentHealthService.getHealth();
  }

  @Get(':type')
  public getAgentByType(@Param('type') type: string) {
    const agent = this.agentRegistryService.resolve(type as AgentType);
    if (!agent) {
      throw new NotFoundException(`Agent type ${type} not found`);
    }
    return {
      type: agent.type,
      version: agent.version,
      displayName: agent.displayName,
      description: agent.description,
      status: agent.status,
      executionMode: agent.executionMode,
      promptId: agent.promptId,
      promptVersion: agent.promptVersion,
      allowedToolNames: agent.allowedToolNames,
      requiredCapabilities: agent.requiredCapabilities,
    };
  }

  @Post(':type/runs')
  public async executeRun(
    @CurrentUser() user: { id: string },
    @Param('type') type: string,
    @Body() body: { input: Record<string, unknown>; async?: boolean },
  ) {
    const agentType = type as AgentType;
    if (body.async) {
      return this.agentExecutionService.executeAsync({
        agentType,
        userId: user.id,
        input: body.input || {},
        invocationSource: AgentInvocationSource.USER_MANUAL,
      });
    }

    return this.agentExecutionService.executeSync({
      agentType,
      userId: user.id,
      input: body.input || {},
      invocationSource: AgentInvocationSource.USER_MANUAL,
    });
  }

  @Post(['system-diagnostic', 'system-diagnostic/run'])
  public async runSystemDiagnostic(
    @Body() body: { symbol?: string; provider?: string },
  ) {
    return this.agentExecutionService.executeSync({
      agentType: AgentType.SYSTEM_DIAGNOSTIC,
      input: { ...(body.symbol ? { symbol: body.symbol } : {}), provider: body.provider },
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
    });
  }
}

@Controller('agent-runs')
@UseGuards(SessionGuard)
export class AgentRunsController {
  constructor(
    private readonly agentRunRepository: AgentRunRepository,
    private readonly agentContextSnapshotRepository: AgentContextSnapshotRepository,
    private readonly agentReplayService: AgentReplayService,
    private readonly agentCancellationHandlerService: AgentCancellationHandlerService,
  ) {}

  @Get()
  public async listRuns(
    @CurrentUser() user: { id: string },
    @Query('agentType') agentType?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.agentRunRepository.findByFilters(user.id, {
      agentType: agentType as AgentType,
      status: status as never,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get(':id')
  public async getRunDetail(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const run = await this.agentRunRepository.findById(id, user.id);
    if (!run) {
      throw new NotFoundException(`Run ${id} not found`);
    }
    return run;
  }

  @Post(':id/cancel')
  public async cancelRun(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const success = await this.agentCancellationHandlerService.cancelRun(id, user.id, body.reason);
    return { success, message: success ? 'Cancellation requested' : 'Cancellation failed' };
  }

  @Post(':id/replay')
  public async replayRun(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.agentReplayService.createReplayRun({
      originalRunId: id,
      userId: user.id,
      reason: body.reason,
    });
  }

  @Get(':id/transitions')
  public async getRunTransitions(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const run = await this.agentRunRepository.findById(id, user.id);
    if (!run) {
      throw new NotFoundException(`Run ${id} not found`);
    }
    return this.agentRunRepository.getTransitions(id);
  }

  @Get(':id/context')
  public async getRunContext(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const run = await this.agentRunRepository.findById(id, user.id);
    if (!run || !run.contextSnapshotId) {
      throw new NotFoundException(`Context snapshot for run ${id} not found`);
    }
    const snapshot = await this.agentContextSnapshotRepository.findById(run.contextSnapshotId);
    if (!snapshot) {
      throw new NotFoundException(`Snapshot ${run.contextSnapshotId} not found`);
    }
    return snapshot;
  }
}
