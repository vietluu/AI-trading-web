import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

import { AgentContextSnapshotRepository } from '../../src/modules/agents/infrastructure/persistence/agent-context-snapshot.repository';

describe('AgentContextSnapshotRepository anticipatory snapshots', () => {
  it('loads only context observations available by the source cutoff', async () => {
    const sourceDataCutoff = new Date('2026-09-09T12:00:00Z');
    const context = {
      news: {
        source: 'REUTERS',
        observations: [{ observedAt: sourceDataCutoff, summary: 'Known at cutoff' }],
      },
    };
    const findFirst = vi.fn().mockResolvedValue({
      serializedContext: { anticipatoryContext: context },
    });
    const repository = new AgentContextSnapshotRepository({
      agentContextSnapshot: { findFirst },
    } as never);

    const result = await repository.findLatestAnticipatoryContext({
      userId: '00000000-0000-4000-8000-000000000001',
      provider: 'BINANCE_FUTURES',
      symbol: 'BTC-USDT',
      timeframe: '1m',
      sourceDataCutoff,
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        userId: '00000000-0000-4000-8000-000000000001',
        provider: 'BINANCE_FUTURES',
        symbol: 'BTC-USDT',
        timeframe: '1m',
        sourceDataCutoff: { lte: sourceDataCutoff },
        serializedContext: {
          path: ['anticipatoryContext'],
          not: Prisma.AnyNull,
        },
      },
      orderBy: { sourceDataCutoff: 'desc' },
    });
    expect(result).toEqual(context);
  });

  it('persists each provider/symbol/timeframe/cutoff key once', async () => {
    const sourceDataCutoff = new Date('2026-09-09T12:00:00Z');
    type FindInput = { where: { contextHash: string } };
    type CreateInput = { data: { contextHash: string } & Record<string, unknown> };
    const create = vi
      .fn<(input: CreateInput) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: 'snapshot-id' });
    const findFirst = vi
      .fn<(input: FindInput) => Promise<null>>()
      .mockResolvedValue(null);
    const repository = new AgentContextSnapshotRepository({
      agentContextSnapshot: { findFirst, create },
    } as never);
    const snapshot = { schemaVersion: 1, calculationVersion: 2 } as never;

    await repository.saveAnticipatorySnapshot({
      userId: '00000000-0000-4000-8000-000000000001',
      provider: 'BINANCE_FUTURES',
      symbol: 'BTC-USDT',
      timeframe: '1m',
      sourceDataCutoff,
      snapshot,
    });

    const persistenceKey = findFirst.mock.calls[0]?.[0]?.where.contextHash;
    expect(persistenceKey).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(create.mock.calls[0]?.[0]).toEqual({
      data: {
        userId: '00000000-0000-4000-8000-000000000001',
        provider: 'BINANCE_FUTURES',
        symbol: 'BTC-USDT',
        timeframe: '1m',
        sourceDataCutoff,
        contextHash: persistenceKey,
        schemaVersion: 1,
        builderVersion: '2',
        tokenEstimate: 0,
        serializedContext: {
          kind: 'ANTICIPATORY_MARKET_SNAPSHOT',
          snapshot,
        },
        marketRefs: [],
        newsRefs: [],
        macroRefs: [],
        sentimentRefs: [],
        memoryRefs: [],
      },
    });
  });
});
