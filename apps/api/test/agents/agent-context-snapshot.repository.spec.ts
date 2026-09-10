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

  it('uses a database upsert keyed by provider, symbol, timeframe and cutoff', async () => {
    const sourceDataCutoff = new Date('2026-09-09T12:00:00Z');
    const persisted = { id: 'snapshot-id' };
    const upsert = vi.fn().mockResolvedValue(persisted);
    const repository = new AgentContextSnapshotRepository({
      anticipatoryMarketSnapshot: { upsert },
    } as never);
    const snapshot = { schemaVersion: 1, calculationVersion: 2 } as never;

    const input = {
      userId: '00000000-0000-4000-8000-000000000001',
      provider: 'BINANCE_FUTURES',
      symbol: 'BTC-USDT',
      timeframe: '1m',
      sourceDataCutoff,
      snapshot,
    };
    const result = await repository.saveAnticipatorySnapshot(input);

    expect(upsert).toHaveBeenCalledWith({
      where: {
        provider_symbol_timeframe_sourceDataCutoff: {
          provider: 'BINANCE_FUTURES',
          symbol: 'BTC-USDT',
          timeframe: '1m',
          sourceDataCutoff,
        },
      },
      update: {},
      create: {
        provider: 'BINANCE_FUTURES',
        symbol: 'BTC-USDT',
        timeframe: '1m',
        sourceDataCutoff,
        schemaVersion: 1,
        calculationVersion: 2,
        snapshotJson: snapshot,
      },
    });
    expect(result).toBe(persisted);
  });
});
