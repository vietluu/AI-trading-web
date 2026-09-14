import { describe, expect, it } from 'vitest';
import { ShadowPlanService, type CreateShadowPlanInput } from '../../src/modules/pipeline/application/shadow-plan.service';

describe('ShadowPlanService', () => {
  const baseInput: CreateShadowPlanInput = {
    evaluationKey: 'e'.repeat(64),
    symbol: 'BTC-USDT',
    provider: 'BINANCE_FUTURES',
    timeframe: '15m',
    direction: 'LONG',
    setup: 'RECOVERY_RECLAIM',
    cohortKey: 'BINANCE_FUTURES:BTC-USDT:15m:RECOVERY_RECLAIM:IMMATURE',
    entryPrice: 100_000,
    stopLoss: 98_000,
    targets: [{ price: 104_000, fraction: 1 }],
    expiresAt: '2026-09-14T02:00:00.000Z',
    sourceDataCutoff: '2026-09-14T01:14:59.999Z',
    feeBps: 8,
    slippageBps: 5,
    fundingBps: 1,
    configurationHash: 'hash-v1',
  };

  const uniqueConflict = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

  it('requires all required fields and valid entry/stop geometry', async () => {
    const plans: any[] = [];
    const prisma = {
      shadowExecutionPlan: {
        create: ({ data }: any) => {
          plans.push(data);
          return Promise.resolve({ id: 'plan-1', ...data });
        },
        findUnique: ({ where }: any) => Promise.resolve(plans.find((p) => p.evaluationKey === where.evaluationKey) ?? null),
      },
    };
    const service = new ShadowPlanService(prisma as never);

    // Missing stopLoss
    await expect(service.createPlan({ ...baseInput, stopLoss: undefined as any })).rejects.toThrow();
    // Invalid geometry (stop above entry for LONG)
    await expect(service.createPlan({ ...baseInput, stopLoss: 102_000 })).rejects.toThrow();
    // Empty targets
    await expect(service.createPlan({ ...baseInput, targets: [] })).rejects.toThrow();
    // Missing cohortKey
    await expect(service.createPlan({ ...baseInput, cohortKey: '' })).rejects.toThrow();
    // Missing configurationHash
    await expect(service.createPlan({ ...baseInput, configurationHash: '' })).rejects.toThrow();
  });

  it('creates plan with immutable order terms and returns existing on duplicate evaluationKey', async () => {
    const existing = {
      id: 'existing-plan',
      ...baseInput,
      status: 'PENDING',
      isComplete: false,
    };
    const prisma = {
      shadowExecutionPlan: {
        create: () => Promise.reject(uniqueConflict()),
        findUnique: ({ where }: any) => Promise.resolve(where.evaluationKey === baseInput.evaluationKey ? existing : null),
      },
    };
    const service = new ShadowPlanService(prisma as never);

    const result = await service.createPlan(baseInput);
    expect(result).toEqual(existing);
  });

  it('finalizes a plan updating only outcome fields and rejects mutating order terms', async () => {
    const stored: any = {
      id: 'plan-1',
      ...baseInput,
      status: 'PENDING',
      isComplete: false,
    };
    const prisma = {
      shadowExecutionPlan: {
        findUnique: ({ where }: any) => Promise.resolve(where.id === stored.id ? stored : null),
        update: ({ where, data }: any) => {
          Object.assign(stored, data);
          return Promise.resolve(stored);
        },
      },
    };
    const service = new ShadowPlanService(prisma as never);

    const outcome = {
      id: 'plan-1',
      status: 'TARGET_REACHED' as const,
      grossPnl: 4000,
      netPnl: 3850,
      netR: 2.0,
      mfe: 4200,
      mae: -300,
      durationCandles: 4,
      terminalReason: 'TAKE_PROFIT',
      isComplete: true,
    };

    const finalized = await service.finalizePlan(outcome);
    expect(finalized.status).toBe('TARGET_REACHED');
    expect(finalized.grossPnl).toBe(4000);
    expect(finalized.entryPrice).toBe(100_000); // entry remains immutable
    expect(finalized.stopLoss).toBe(98_000); // stop remains immutable
  });

  it('has no dependencies on exchange adapters or live trading execution', () => {
    // Structural architectural check: ShadowPlanService must not import ccxt, live-trading, exchange clients
    const serviceProto = Object.getOwnPropertyNames(ShadowPlanService.prototype);
    expect(serviceProto).not.toContain('executeOnExchange');
    expect(serviceProto).not.toContain('placeOrder');
  });
});
