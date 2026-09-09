import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import { PostMortemAnalyzerService } from '../src/modules/reflection/application/post-mortem-analyzer.service';
import { buildPostMortemContext } from '../src/modules/agents/domain/analysis/post-mortem-memory-injector';

describe('PostMortemAnalyzerService', () => {
  let service: PostMortemAnalyzerService;
  let prisma: {
    aIMemory: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prisma = {
      aIMemory: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      }
    };
    service = new PostMortemAnalyzerService(prisma as unknown as PrismaService);
  });

  it('should return null if outcome is not WRONG', async () => {
    const result = await service.analyzeFailedRun({
      runId: '123',
      userId: 'u1',
      symbol: 'BTC',
      decision: 'LONG',
      outcome: 'CORRECT',
      returnPct: 1,
    });
    expect(result).toBeNull();
  });

  it('should detect TRAP_ENTRY root cause', async () => {
    const result = await service.analyzeFailedRun({
      runId: '123',
      userId: 'u1',
      symbol: 'BTC',
      decision: 'LONG',
      outcome: 'WRONG',
      returnPct: -2.5,
      storedContext: { isExtendedEntry: true, agentVotes: { trend: 'LONG', macro: 'LONG' } }
    });
    expect(result?.rootCause).toBe('TRAP_ENTRY');
    expect(result?.penaltyAdjustments).toEqual({ trend: -3, macro: -3 });
  });

  it('should detect REGIME_MISMATCH root cause', async () => {
    const result = await service.analyzeFailedRun({
      runId: '123',
      userId: 'u1',
      symbol: 'BTC',
      decision: 'LONG',
      outcome: 'WRONG',
      returnPct: -2.5,
      marketRegime: 'TRENDING',
      storedContext: { actualRegime: 'RANGING', agentVotes: { trend: 'LONG' } }
    });
    expect(result?.rootCause).toBe('REGIME_MISMATCH');
    expect(result?.penaltyAdjustments).toEqual({ trend: -3 });
  });

  it('should detect AGENT_DISAGREEMENT root cause', async () => {
    const result = await service.analyzeFailedRun({
      runId: '123',
      userId: 'u1',
      symbol: 'BTC',
      decision: 'LONG',
      outcome: 'WRONG',
      returnPct: -2.5,
      storedContext: { agentVotes: { trend: 'LONG', macro: 'LONG', liquidity: 'LONG', meanReversion: 'SHORT' } }
    });
    expect(result?.rootCause).toBe('AGENT_DISAGREEMENT');
  });

  it('should detect recurring patterns', async () => {
    prisma.aIMemory.findMany.mockResolvedValue([
      { content: { symbol: 'BTC', regime: 'RANGING', rootCause: 'TRAP_ENTRY' }, createdAt: new Date() },
      { content: { symbol: 'BTC', regime: 'RANGING', rootCause: 'TRAP_ENTRY' }, createdAt: new Date() },
      { content: { symbol: 'ETH', regime: 'TRENDING', rootCause: 'TIMING_ERROR' }, createdAt: new Date() }
    ]);
    const patterns = await service.findRecurringPatterns('u1');
    expect(patterns.length).toBe(1);
    expect(patterns[0]!.pattern).toBe('BTC:RANGING:TRAP_ENTRY');
    expect(patterns[0]!.count).toBe(2);
  });
});

describe('PostMortemMemoryInjector', () => {
  it('should build context correctly', () => {
    const memories = [
      { content: { symbol: 'BTC', regime: 'RANGING', rootCause: 'TRAP_ENTRY', recommendation: 'rec1', penaltyAdjustments: { trend: -3 } } },
      { content: { symbol: 'BTC', regime: 'RANGING', rootCause: 'TRAP_ENTRY', recommendation: 'rec2', penaltyAdjustments: { macro: -2 } } }
    ];
    const ctx = buildPostMortemContext(memories, 'BTC', 'RANGING');
    expect(ctx.recentLosses.length).toBe(2);
    expect(ctx.recurringPatterns.length).toBe(1);
    expect(ctx.recurringPatterns[0]!.pattern).toBe('BTC:RANGING:TRAP_ENTRY');
    expect(ctx.cautionAdvice).toContain('Require higher confidence threshold');
    expect(ctx.penalties).toEqual({ trend: -3, macro: -2 });
  });
});
