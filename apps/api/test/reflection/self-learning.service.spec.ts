import { describe, expect, it, vi } from 'vitest';
import { SelfLearningService } from '../../src/modules/reflection/application/self-learning.service';
import { BASE_WEIGHTS } from '../../src/modules/agents/domain/constants/decision.constants';

function lifecycleRow(thesisId: string, netR: number, sequence: number) {
  return {
    id: `outcome-${thesisId}`,
    thesisId,
    symbol: 'BTC-USDT',
    provider: 'BINANCE',
    timeframe: '15m',
    direction: 'LONG',
    setup: 'BREAKOUT',
    regime: 'TRENDING_UP',
    status: 'FINALIZED',
    sourceDataCutoff: new Date('2026-09-01T00:00:00.000Z'),
    openedAt: new Date(`2026-09-${String(1 + sequence).padStart(2, '0')}T00:00:00.000Z`),
    closedAt: new Date(`2026-09-${String(1 + sequence).padStart(2, '0')}T01:00:00.000Z`),
    totalEnteredQuantity: 1,
    totalExitedQuantity: 1,
    averageEntryPrice: 100,
    averageExitPrice: 100 + netR * 10,
    realizedGrossPnl: netR * 10,
    signedFees: 0,
    signedFunding: 0,
    realizedNetPnl: netR * 10,
    initialRisk: 10,
    netR,
    configurationHash: 'v1',
    schemaVersion: 1,
    calculationVersion: 1,
  };
}

describe('SelfLearningService.evaluateShadowSignals promotion state machine integration', () => {
  const userId = 'user-test-uuid';

  it('returns exact lifecycle profitability authority instead of broad-cohort approval', async () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      lifecycleRow(`thesis-${index}`, index % 3 === 0 ? -1 : 1, index),
    );
    const prisma = {
      tradeLifecycleOutcome: { findMany: vi.fn().mockResolvedValue(rows) },
    };
    const service = new SelfLearningService(prisma as never, {} as never);

    const authority = await service.evaluateProfitAuthorityForThesis(
      'BTC-USDT|15m|TRENDING_UP|LONG|BREAKOUT|v1',
    );

    expect(authority).toMatchObject({
      action: 'FULL_SIZE',
      sampleSize: 30,
      sizeFactor: 1,
      sequentialWindows: { allPositive: true },
    });
  });

  it('promotes SHADOW candidate to DEMO_CANARY when promotion transition is allowed', async () => {
    let storedConfig: Record<string, unknown> = {
      userId,
      shadowEnabled: true,
      shadowVersion: 2,
      liveVersion: 1,
      weightsJson: BASE_WEIGHTS,
      confidenceThreshold: 60,
      shadowWeightsJson: BASE_WEIGHTS,
      shadowThreshold: 60,
      candidateShadowTrades: 0,
      shadowPerformance: null,
      shadowStartedAt: new Date(Date.now() - 5 * 24 * 60 * 60_000),
      canaryEnabled: false,
      canaryVersion: null,
    };

    // Generate 100 successful trade lifecycle outcomes so sampleSize >= 100
    const mockLifecycleOutcomes = Array.from({ length: 100 }, (_, i) => ({
      id: `lifecycle-${i}`,
      thesisId: `thesis-${i}`,
      symbol: 'BTCUSDT',
      provider: 'BINANCE_FUTURES',
      timeframe: '1h',
      direction: 'LONG',
      setup: 'BREAKOUT',
      regime: 'TRENDING_BULL',
      status: 'FINALIZED',
      sourceDataCutoff: new Date(),
      openedAt: new Date(),
      closedAt: new Date(),
      totalEnteredQuantity: 1,
      totalExitedQuantity: 1,
      averageEntryPrice: 50000,
      averageExitPrice: 51000,
      realizedGrossPnl: 100,
      signedFees: -1,
      signedFunding: 0,
      realizedNetPnl: 99,
      initialRisk: 50,
      netR: 1.98,
      finalStopLoss: 49000,
      schemaVersion: '1.0.0',
      calculationVersion: 2,
      configurationHash: 'a'.repeat(64),
      metadata: {},
    }));

    const updateSpy = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      storedConfig = { ...storedConfig, ...data };
      return Promise.resolve(storedConfig);
    });

    const prisma = {
      selfLearningConfiguration: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(storedConfig)),
        create: vi.fn(),
        update: updateSpy,
      },
      paperSignal: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      tradeLifecycleOutcome: {
        findMany: vi.fn().mockResolvedValue(mockLifecycleOutcomes),
      },
      performanceRecord: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      selfLearningExperiment: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const configService = {
      get: vi.fn().mockImplementation((key: string, fallback: unknown) => {
        if (key === 'SELF_LEARNING_MIN_SHADOW_TRADES') return 100;
        return fallback;
      }),
    };

    const service = new SelfLearningService(prisma as never, configService as never);
    await service.evaluateShadowSignals(userId);

    // Verify configuration was updated to advance to CANARY
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId },
        data: expect.objectContaining({
          shadowEnabled: false,
          canaryEnabled: true,
          canaryVersion: 2,
        }) as unknown,
      }),
    );
  });

  it('rejects SHADOW candidate when DRAWDOWN_BREACH occurs', async () => {
    let storedConfig: Record<string, unknown> = {
      userId,
      shadowEnabled: true,
      shadowVersion: 2,
      liveVersion: 1,
      weightsJson: BASE_WEIGHTS,
      confidenceThreshold: 60,
      shadowWeightsJson: BASE_WEIGHTS,
      shadowThreshold: 60,
      candidateShadowTrades: 0,
      shadowPerformance: null,
      shadowStartedAt: new Date(Date.now() - 5 * 24 * 60 * 60_000),
      canaryEnabled: false,
      canaryVersion: null,
    };

    const outcomes: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 50; i++) {
      outcomes.push({
        id: `lifecycle-win-${i}`,
        thesisId: `thesis-${i}`,
        symbol: 'BTCUSDT',
        provider: 'BINANCE_FUTURES',
        timeframe: '1h',
        direction: 'LONG',
        status: 'FINALIZED',
        sourceDataCutoff: new Date(),
        openedAt: new Date(),
        closedAt: new Date(Date.now() - (100 - i) * 60_000),
        totalEnteredQuantity: 1,
        totalExitedQuantity: 1,
        averageEntryPrice: 50000,
        averageExitPrice: 51000,
        realizedGrossPnl: 100,
        signedFees: 0,
        signedFunding: 0,
        realizedNetPnl: 100,
        initialRisk: 50,
        netR: 2.0,
        finalStopLoss: 49000,
        schemaVersion: '1.0.0',
        calculationVersion: 2,
        configurationHash: 'a'.repeat(64),
        metadata: {},
      });
    }
    for (let i = 50; i < 100; i++) {
      outcomes.push({
        id: `lifecycle-loss-${i}`,
        thesisId: `thesis-${i}`,
        symbol: 'BTCUSDT',
        provider: 'BINANCE_FUTURES',
        timeframe: '1h',
        direction: 'LONG',
        status: 'FINALIZED',
        sourceDataCutoff: new Date(),
        openedAt: new Date(),
        closedAt: new Date(Date.now() - (100 - i) * 60_000),
        totalEnteredQuantity: 1,
        totalExitedQuantity: 1,
        averageEntryPrice: 50000,
        averageExitPrice: 48000,
        realizedGrossPnl: -200,
        signedFees: 0,
        signedFunding: 0,
        realizedNetPnl: -200,
        initialRisk: 50,
        netR: -4.0,
        finalStopLoss: 49000,
        schemaVersion: '1.0.0',
        calculationVersion: 2,
        configurationHash: 'a'.repeat(64),
        metadata: { maxReportedMarkDrawdownPct: 20.0 },
      });
    }

    const updateSpy = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      storedConfig = { ...storedConfig, ...data };
      return Promise.resolve(storedConfig);
    });
    const updateManySpy = vi.fn().mockResolvedValue({ count: 0 });

    const prisma = {
      selfLearningConfiguration: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(storedConfig)),
        create: vi.fn(),
        update: updateSpy,
      },
      paperSignal: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        updateMany: updateManySpy,
      },
      tradeLifecycleOutcome: {
        findMany: vi.fn().mockResolvedValue(outcomes),
      },
      performanceRecord: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      selfLearningExperiment: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const configService = {
      get: vi.fn().mockImplementation((key: string, fallback: unknown) => {
        if (key === 'SELF_LEARNING_MIN_SHADOW_TRADES') return 100;
        if (key === 'SELF_LEARNING_MAX_DRAWDOWN_PCT') return 10;
        return fallback;
      }),
    };

    const service = new SelfLearningService(prisma as never, configService as never);
    await service.evaluateShadowSignals(userId);

    // Verify rejection occurred (shadow disabled, canary not enabled, paper signals marked SUPERSEDED)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId },
        data: expect.objectContaining({
          shadowEnabled: false,
          shadowVersion: null,
        }) as unknown,
      }),
    );
    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId,
          mode: 'SHADOW',
          configurationVersion: 2,
        }) as unknown,
        data: { outcome: 'SUPERSEDED' },
      }),
    );
  });
});
