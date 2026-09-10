import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import {
  type AgentContextSnapshot,
  type AnticipatoryMarketSnapshot as AnticipatoryMarketSnapshotRow,
  Prisma,
} from '@prisma/client';
import type { AnticipatoryMarketSnapshot } from '@platform/shared';
import type { AnticipatoryContextInput } from '../../domain/analysis/anticipatory-snapshot-builder';

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

  public async findLatestAnticipatoryContext(query: {
    userId: string;
    provider: string;
    symbol: string;
    timeframe: string;
    sourceDataCutoff: Date;
  }): Promise<AnticipatoryContextInput | undefined> {
    const row = await this.databaseService.agentContextSnapshot.findFirst({
      where: {
        userId: query.userId,
        provider: query.provider,
        symbol: query.symbol,
        timeframe: query.timeframe,
        sourceDataCutoff: { lte: query.sourceDataCutoff },
        serializedContext: {
          path: ['anticipatoryContext'],
          not: Prisma.AnyNull,
        },
      },
      orderBy: { sourceDataCutoff: 'desc' },
    });
    const serialized = row?.serializedContext;
    if (
      serialized === null ||
      typeof serialized !== 'object' ||
      Array.isArray(serialized) ||
      !('anticipatoryContext' in serialized)
    ) {
      return undefined;
    }
    return serialized.anticipatoryContext as AnticipatoryContextInput;
  }

  public async saveAnticipatorySnapshot(input: {
    userId: string;
    provider: string;
    symbol: string;
    timeframe: string;
    sourceDataCutoff: Date;
    snapshot: AnticipatoryMarketSnapshot;
  }): Promise<AnticipatoryMarketSnapshotRow> {
    return this.databaseService.anticipatoryMarketSnapshot.upsert({
      where: {
        provider_symbol_timeframe_sourceDataCutoff: {
          provider: input.provider,
          symbol: input.symbol,
          timeframe: input.timeframe,
          sourceDataCutoff: input.sourceDataCutoff,
        },
      },
      update: {},
      create: {
        provider: input.provider,
        symbol: input.symbol,
        timeframe: input.timeframe,
        sourceDataCutoff: input.sourceDataCutoff,
        schemaVersion: input.snapshot.schemaVersion,
        calculationVersion: input.snapshot.calculationVersion,
        snapshotJson: input.snapshot,
      },
    });
  }
}
