import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AgentContextSnapshot, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
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
  }): Promise<AgentContextSnapshot> {
    // Temporary Task 3 adapter: this lookup reuses sequential duplicates only.
    // Task 4 must replace it with the dedicated snapshot table and its database
    // unique key before any scheduler starts observing snapshots.
    const persistenceKey = createHash('sha256')
      .update([
        'ANTICIPATORY_MARKET_SNAPSHOT',
        input.userId,
        input.provider,
        input.symbol,
        input.timeframe,
        input.sourceDataCutoff.toISOString(),
      ].join(':'))
      .digest('hex');
    const existing = await this.findByHash(persistenceKey);
    if (existing) return existing;

    return this.create({
      userId: input.userId,
      provider: input.provider,
      symbol: input.symbol,
      timeframe: input.timeframe,
      sourceDataCutoff: input.sourceDataCutoff,
      schemaVersion: input.snapshot.schemaVersion,
      builderVersion: String(input.snapshot.calculationVersion),
      contextHash: persistenceKey,
      serializedContext: {
        kind: 'ANTICIPATORY_MARKET_SNAPSHOT',
        snapshot: input.snapshot,
      },
    });
  }
}
