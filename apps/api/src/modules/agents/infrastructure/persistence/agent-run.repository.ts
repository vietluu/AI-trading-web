import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AgentType, AgentRunState, AgentInvocationSource } from '../../domain/enums';
import { AgentRun, AgentRunTransition, Prisma } from '@prisma/client';

export interface CreateAgentRunInput {
  userId?: string;
  agentType: AgentType;
  agentVersion: number;
  invocationSource: AgentInvocationSource;
  inputHash: string;
  sanitizedInput?: Prisma.InputJsonValue;
  promptId: string;
  promptVersion: number;
  traceId: string;
  correlationId: string;
  parentRunId?: string;
  replayOfRunId?: string;
}

export interface UpdateAgentRunInput {
  status?: AgentRunState;
  sanitizedInput?: Prisma.InputJsonValue;
  output?: Prisma.InputJsonValue;
  outputSchemaVersion?: number;
  contextSnapshotId?: string;
  provider?: string;
  model?: string;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  estimatedCost?: Prisma.Decimal | number;
  actualCost?: Prisma.Decimal | number;
  toolCallCount?: number;
  toolRoundCount?: number;
  retryCount?: number;
  failureCode?: string;
  safeFailureMessage?: string;
}

export interface AgentRunFilterOptions {
  agentType?: AgentType;
  status?: AgentRunState;
  provider?: string;
  model?: string;
  invocationSource?: AgentInvocationSource;
  createdFrom?: Date;
  createdTo?: Date;
  parentRunId?: string;
  replayOfRunId?: string;
  page?: number;
  limit?: number;
  sort?: 'asc' | 'desc';
}

@Injectable()
export class AgentRunRepository {
  constructor(private readonly databaseService: PrismaService) {}

  public async createRun(data: CreateAgentRunInput): Promise<AgentRun> {
    return this.databaseService.agentRun.create({
      data: {
        userId: data.userId,
        agentType: data.agentType,
        agentVersion: data.agentVersion,
        invocationSource: data.invocationSource,
        inputHash: data.inputHash,
        sanitizedInput: data.sanitizedInput,
        promptId: data.promptId,
        promptVersion: data.promptVersion,
        traceId: data.traceId,
        correlationId: data.correlationId,
        parentRunId: data.parentRunId,
        replayOfRunId: data.replayOfRunId,
        status: AgentRunState.CREATED,
      },
    });
  }

  public async updateRun(id: string, data: UpdateAgentRunInput): Promise<AgentRun> {
    return this.databaseService.agentRun.update({
      where: { id },
      data,
    });
  }

  public async findById(id: string, userId?: string): Promise<AgentRun | null> {
    const where: Prisma.AgentRunWhereInput = { id };
    if (userId) {
      where.userId = userId;
    }
    return this.databaseService.agentRun.findFirst({ where });
  }

  public async findByUser(
    userId: string,
    filters: {
      agentType?: AgentType;
      status?: AgentRunState;
      limit?: number;
      offset?: number;
      sort?: 'asc' | 'desc';
    } = {},
  ): Promise<AgentRun[]> {
    const { agentType, status, limit = 10, offset = 0, sort = 'desc' } = filters;
    const where: Prisma.AgentRunWhereInput = { userId };

    if (agentType) where.agentType = agentType;
    if (status) where.status = status;

    return this.databaseService.agentRun.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: sort },
    });
  }

  public async findByFilters(
    userId: string | undefined,
    filters: AgentRunFilterOptions = {},
  ): Promise<{ data: AgentRun[]; total: number }> {
    const {
      agentType,
      status,
      provider,
      model,
      invocationSource,
      createdFrom,
      createdTo,
      parentRunId,
      replayOfRunId,
      page = 1,
      limit = 20,
      sort = 'desc',
    } = filters;

    const where: Prisma.AgentRunWhereInput = {};

    if (userId) where.userId = userId;
    if (agentType) where.agentType = agentType;
    if (status) where.status = status;
    if (provider) where.provider = provider;
    if (model) where.model = model;
    if (invocationSource) where.invocationSource = invocationSource;
    if (parentRunId) where.parentRunId = parentRunId;
    if (replayOfRunId) where.replayOfRunId = replayOfRunId;

    if (createdFrom || createdTo) {
      where.createdAt = {};
      if (createdFrom) where.createdAt.gte = createdFrom;
      if (createdTo) where.createdAt.lte = createdTo;
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.databaseService.agentRun.findMany({
        where,
        take: limit,
        skip,
        orderBy: { createdAt: sort },
      }),
      this.databaseService.agentRun.count({ where }),
    ]);

    return { data, total };
  }

  public async addTransition(data: {
    runId: string;
    fromState: AgentRunState;
    toState: AgentRunState;
    reason: string;
    actor: string;
    correlationId?: string;
  }): Promise<AgentRunTransition> {
    return this.databaseService.agentRunTransition.create({
      data: {
        runId: data.runId,
        fromState: data.fromState,
        toState: data.toState,
        reason: data.reason,
        actor: data.actor,
        correlationId: data.correlationId,
      },
    });
  }

  public async getTransitions(runId: string): Promise<AgentRunTransition[]> {
    return this.databaseService.agentRunTransition.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });
  }

  public async countActiveRuns(userId?: string, agentType?: AgentType): Promise<number> {
    const activeStatuses = [
      AgentRunState.CREATED,
      AgentRunState.QUEUED,
      AgentRunState.PREPARING_CONTEXT,
      AgentRunState.READY,
      AgentRunState.RUNNING,
      AgentRunState.WAITING_FOR_TOOL,
      AgentRunState.PROCESSING_TOOL_RESULT,
      AgentRunState.VALIDATING_OUTPUT,
    ];

    const where: Prisma.AgentRunWhereInput = {
      status: { in: activeStatuses },
    };

    if (userId) where.userId = userId;
    if (agentType) where.agentType = agentType;

    return this.databaseService.agentRun.count({ where });
  }

  public async getStatsForAgent(agentType: AgentType): Promise<{
    avgLatencyMs: number;
    successRatePct: number;
    totalRuns: number;
  }> {
    const totalRuns = await this.databaseService.agentRun.count({
      where: { agentType },
    });

    if (totalRuns === 0) {
      return { avgLatencyMs: 0, successRatePct: 100, totalRuns: 0 };
    }

    const completedRuns = await this.databaseService.agentRun.count({
      where: { agentType, status: AgentRunState.COMPLETED },
    });

    const aggregate = await this.databaseService.agentRun.aggregate({
      where: { agentType, status: AgentRunState.COMPLETED },
      _avg: { durationMs: true },
    });

    return {
      avgLatencyMs: Math.round(aggregate._avg?.durationMs || 0),
      successRatePct: Math.round((completedRuns / totalRuns) * 10000) / 100,
      totalRuns,
    };
  }

  public async saveOutput(data: {
    runId: string;
    schemaVersion: number;
    validatedOutput: Prisma.InputJsonValue;
    rawOutput?: string;
  }) {
    return this.databaseService.agentRunOutput.create({
      data: {
        runId: data.runId,
        schemaVersion: data.schemaVersion,
        validatedOutput: data.validatedOutput,
        rawOutput: data.rawOutput,
      },
    });
  }
}
