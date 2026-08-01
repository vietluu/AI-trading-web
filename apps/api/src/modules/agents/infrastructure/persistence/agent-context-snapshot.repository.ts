import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AgentContextSnapshot, Prisma } from '@prisma/client';

export interface CreateAgentContextSnapshotInput {
  userId?: string;
  symbol?: string;
  provider?: string;
  timeframe?: string;
  sourceDataCutoff: Date;
  schemaVersion?: number;
  builderVersion?: string;
  contextHash: string;
  tokenEstimate?: number;
  serializedContext: Prisma.InputJsonValue;
  marketRefs?: string[];
  newsRefs?: string[];
  macroRefs?: string[];
  sentimentRefs?: string[];
  memoryRefs?: string[];
}

@Injectable()
export class AgentContextSnapshotRepository {
  constructor(private readonly databaseService: PrismaService) {}

  public async create(data: CreateAgentContextSnapshotInput): Promise<AgentContextSnapshot> {
    return this.databaseService.agentContextSnapshot.create({
      data: {
        userId: data.userId,
        symbol: data.symbol,
        provider: data.provider,
        timeframe: data.timeframe,
        sourceDataCutoff: data.sourceDataCutoff,
        schemaVersion: data.schemaVersion ?? 1,
        builderVersion: data.builderVersion ?? '1.0.0',
        contextHash: data.contextHash,
        tokenEstimate: data.tokenEstimate ?? 0,
        serializedContext: data.serializedContext,
        marketRefs: data.marketRefs ?? [],
        newsRefs: data.newsRefs ?? [],
        macroRefs: data.macroRefs ?? [],
        sentimentRefs: data.sentimentRefs ?? [],
        memoryRefs: data.memoryRefs ?? [],
      },
    });
  }

  public async findById(id: string): Promise<AgentContextSnapshot | null> {
    return this.databaseService.agentContextSnapshot.findUnique({
      where: { id },
    });
  }

  public async findByHash(contextHash: string): Promise<AgentContextSnapshot | null> {
    return this.databaseService.agentContextSnapshot.findFirst({
      where: { contextHash },
    });
  }
}
