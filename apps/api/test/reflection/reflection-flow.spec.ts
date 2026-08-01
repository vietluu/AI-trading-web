import { Prisma } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { PerformanceService } from '../../src/modules/reflection/application/performance.service';
import { ReflectionService } from '../../src/modules/reflection/application/reflection.service';
import type { ReflectionRepository } from '../../src/modules/reflection/infrastructure/reflection.repository';

describe('pipeline evaluation and reflection flow', () => {
  it('turns a completed pipeline decision into horizon records from public candles', async () => {
    const createRecord = vi.fn().mockResolvedValue({});
    const repository = {
      completedRuns: vi.fn().mockResolvedValue([{
        id: crypto.randomUUID(), userId: crypto.randomUUID(), symbol: 'BTC-USDT', provider: 'BINANCE_FUTURES',
        decision: 'LONG', confidence: 80, completedAt: new Date(Date.now() - 25 * 60 * 60_000),
        storedContext: { analyses: { market: { volatility: { level: 'HIGH' } } } }, performanceRecords: [],
      }]),
      candleAtOrBefore: vi.fn().mockResolvedValue({ close: new Prisma.Decimal(100) }),
      candleAtOrAfter: vi.fn().mockResolvedValue({ close: new Prisma.Decimal(110) }),
      createRecord,
    } as unknown as ReflectionRepository;
    const config = { get: <T>(_key: string, fallback: T) => fallback } as ConfigService;
    const result = await new PerformanceService(repository, config).evaluateDue();
    expect(result.evaluated).toBe(3);
    expect(createRecord).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'CORRECT', returnPct: 10, highVolatility: true }));
  });

  it('detects volatility weakness and persists insights without applying changes', async () => {
    const now = new Date();
    const rows = Array.from({ length: 20 }, (_, index) => ({
      id: crypto.randomUUID(), runId: crypto.randomUUID(), userId: crypto.randomUUID(), symbol: 'BTC-USDT', horizon: 'SHORT' as const,
      decision: index < 10 ? 'LONG' : 'SHORT', confidence: 75, priceAtDecision: new Prisma.Decimal(100), priceAfter: new Prisma.Decimal(index < 5 ? 90 : 110),
      outcome: index < 5 ? 'WRONG' as const : 'CORRECT' as const, returnPct: index < 5 ? -10 : 10,
      highVolatility: index < 5, majorNews: false, evaluatedAt: now,
    }));
    const createInsights = vi.fn().mockResolvedValue({ count: 1 });
    const repository = { records: vi.fn().mockResolvedValue(rows), createInsights } as unknown as ReflectionRepository;
    const config = { get: <T>(_key: string, fallback: T) => fallback } as ConfigService;
    const output = await new ReflectionService(repository, config).generate(rows[0]!.userId);
    expect(output.ready).toBe(true);
    expect(output.patterns).toContain('Decisions underperform during high-volatility spikes.');
    expect(output.suggestions.some((value) => value.includes('WAIT threshold'))).toBe(true);
    expect(createInsights).toHaveBeenCalled();
  });
});
