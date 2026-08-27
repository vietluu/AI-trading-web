import { Prisma } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { PerformanceService } from '../../src/modules/reflection/application/performance.service';
import { ReflectionService } from '../../src/modules/reflection/application/reflection.service';
import type { ReflectionRepository } from '../../src/modules/reflection/infrastructure/reflection.repository';

describe('pipeline evaluation and reflection flow', () => {
  it('turns a completed pipeline decision into horizon records from public candles', async () => {
    const createRecord = vi.fn().mockResolvedValue({});
    const startTimestamp = new Date('2026-08-01T00:00:00Z');
    const candleAtOrBefore = vi.fn().mockResolvedValue({ close: new Prisma.Decimal(100), closeTime: startTimestamp });
    const candleAtOrAfter = vi.fn().mockImplementation(
      (_provider, _symbol, target: Date) => Promise.resolve({
        close: new Prisma.Decimal(110),
        closeTime: new Date(target.getTime() + 1_000),
      }),
    );
    const repository = {
      completedRuns: vi.fn().mockResolvedValue([{
        id: crypto.randomUUID(), userId: crypto.randomUUID(), symbol: 'BTC-USDT', provider: 'BINANCE_FUTURES',
        decision: 'LONG', confidence: 80, completedAt: new Date(Date.now() - 25 * 60 * 60_000),
        storedContext: { analyses: { market: { volatility: { level: 'HIGH' } } } }, performanceRecords: [],
      }]),
      candleAtOrBefore,
      candleAtOrAfter,
      createRecord,
    } as unknown as ReflectionRepository;
    const config = { get: <T>(_key: string, fallback: T) => fallback } as ConfigService;
    const result = await new PerformanceService(repository, config).evaluateDue();
    expect(result.evaluated).toBe(7);
    expect(candleAtOrBefore).toHaveBeenCalledWith(
      'BINANCE_FUTURES', 'BTC-USDT', expect.any(Date), 15 * 60_000,
    );
    expect(candleAtOrAfter).toHaveBeenCalledWith(
      'BINANCE_FUTURES', 'BTC-USDT', expect.any(Date), 15 * 60_000,
    );
    expect(createRecord).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'CORRECT', returnPct: 9.9, leverage: 1, netRoePct: 9.9,
      leverageSource: 'UNLEVERAGED', highVolatility: true,
      actualStartTimestamp: startTimestamp,
      timeDriftMs: 1_000,
    }));
    const firstCreated = createRecord.mock.calls[0]?.[0] as {
      actualTargetTimestamp?: unknown;
    };
    expect(firstCreated.actualTargetTimestamp).toBeInstanceOf(Date);
  });

  it('keeps an evaluation pending when no candle exists near the target horizon', async () => {
    const createRecord = vi.fn();
    const candleAtOrAfter = vi.fn().mockResolvedValue(null);
    const repository = {
      completedRuns: vi.fn().mockResolvedValue([{
        id: crypto.randomUUID(), userId: crypto.randomUUID(), symbol: 'BTC-USDT', provider: 'BINANCE_FUTURES',
        timeframe: '5m', decision: 'LONG', confidence: 80,
        completedAt: new Date(Date.now() - 2 * 60 * 60_000), storedContext: {}, performanceRecords: [],
      }]),
      candleAtOrBefore: vi.fn().mockResolvedValue({ close: new Prisma.Decimal(100) }),
      candleAtOrAfter,
      createRecord,
    } as unknown as ReflectionRepository;
    const config = { get: <T>(_key: string, fallback: T) => fallback } as ConfigService;

    const result = await new PerformanceService(repository, config).evaluateDue();

    expect(result.skippedForMissingTargetPrice).toBeGreaterThan(0);
    expect(createRecord).not.toHaveBeenCalled();
    expect(candleAtOrAfter).toHaveBeenCalledWith(
      'BINANCE_FUTURES', 'BTC-USDT', expect.any(Date), 5 * 60_000,
    );
  });

  it('evaluates a blocked directional candidate in shadow instead of learning WAIT', async () => {
    const createRecord = vi.fn().mockResolvedValue({});
    const repository = {
      completedRuns: vi.fn().mockResolvedValue([{
        id: crypto.randomUUID(), userId: crypto.randomUUID(), symbol: 'ZRO-USDT', provider: 'OKX_FUTURES',
        decision: 'WAIT', confidence: 75, completedAt: new Date(Date.now() - 2 * 60 * 60_000),
        storedContext: {
          candidateDecision: {
            decision: 'SHORT', confidence: 75, strategyKey: 'ai-core',
            actionable: false, blockedReasons: ['QUANT_WALK_FORWARD_UNSTABLE'],
          },
        },
        performanceRecords: [{ horizon: 'SHORT' }],
      }]),
      candleAtOrBefore: vi.fn().mockResolvedValue({ close: new Prisma.Decimal(1) }),
      candleAtOrAfter: vi.fn().mockResolvedValue({ close: new Prisma.Decimal(0.9) }),
      createRecord,
    } as unknown as ReflectionRepository;
    const config = { get: <T>(_key: string, fallback: T) => fallback } as ConfigService;

    await new PerformanceService(repository, config).evaluateDue();

    expect(createRecord).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'SHORT', confidence: 75, strategyKey: 'ai-core', outcome: 'CORRECT', leverage: 5,
      netRoePct: 49.5, leverageSource: 'SHADOW_CONFIG',
    }));
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
