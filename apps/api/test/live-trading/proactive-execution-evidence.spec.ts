import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveTradingService } from '../../src/modules/live-trading/application/live-trading.service';
import { ExchangeProvider } from '../../src/exchange/domain/exchange.types';

const now = new Date('2026-09-09T12:00:00Z');
function fixture(bid: string | undefined = '99', positions = [{ quantity: '-2', markPrice: '100', updatedAt: now }]) {
  const service = new LiveTradingService({} as never,
    { list: () => Promise.resolve([{ id: 'demo', provider: ExchangeProvider.OKX_FUTURES, environment: 'DEMO', isEnabled: true, isVerified: true }]),
      instrument: () => Promise.resolve({ tickSize: '0.1', stepSize: '0.001' }), positions: () => Promise.resolve(positions) } as never,
    {} as never, {} as never, { getUserLimits: () => Promise.resolve({ estimatedRoundTripCostPct: 0.001 }) } as never, {} as never, {} as never,
    { ticker: () => Promise.resolve({ provider: ExchangeProvider.OKX_FUTURES, symbol: 'BTC-USDT', bidPrice: bid, askPrice: '101', lastPrice: '100', timestamp: now }) } as never);
  return service;
}
describe('proactive execution evidence provenance', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());
  it('uses observed spread, absolute position exposure, and cost in price units', async () => {
    const evidence = await fixture().proactiveExecutionEvidence('user-1', ExchangeProvider.OKX_FUTURES, 'BTC-USDT');
    expect(evidence).toMatchObject({ currentPrice: 100, spread: 2, currentExposure: 200, estimatedRoundTripCost: 0.1, timestamp: now });
    expect(evidence?.source).toContain('QUOTE:OKX_FUTURES');
    expect(evidence?.source).toContain('POSITIONS:demo');
  });
  it('marks missing spread unavailable instead of assigning zero', async () => {
    expect(await fixture('').proactiveExecutionEvidence('user-1', ExchangeProvider.OKX_FUTURES, 'BTC-USDT')).toBeUndefined();
  });
  it('allows observed empty account exposure to be zero', async () => {
    expect(await fixture('99', []).proactiveExecutionEvidence('user-1', ExchangeProvider.OKX_FUTURES, 'BTC-USDT')).toMatchObject({ currentExposure: 0 });
  });
});

describe('pipeline LIMIT execution integrity', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());

  it('submits an approved pullback as LIMIT without market fallback', async () => {
    const placeOrder = vi.fn().mockResolvedValue({
      exchangeOrderId: 'ord-limit-1',
      clientOrderId: 'p9run1',
      symbol: 'ZRO-USDT',
      side: 'SELL',
      type: 'LIMIT',
      quantity: '100',
      executedQuantity: '0',
      status: 'NEW',
    });
    const connection = {
      id: 'conn-demo',
      provider: ExchangeProvider.OKX_FUTURES,
      environment: 'DEMO',
      isEnabled: true,
      isVerified: true,
    };
    const assessment = {
      id: 'risk-1',
      pipelineRunId: 'run-1',
      userId: 'user-1',
      connectionId: 'conn-demo',
      approved: true,
      decision: 'SHORT',
      symbol: 'ZRO-USDT',
      positionSize: 100,
      leverage: 2,
      referencePrice: 1.0200,
      createdAt: now,
      tradePlan: {
        orderType: 'LIMIT',
        limitEntryPrice: 1.01826901,
        limitTtlCandles: 2,
        timeframeMs: 900_000,
      },
    };
    const prisma = {
      riskAssessment: {
        findUnique: vi.fn().mockResolvedValue(assessment),
        findFirst: vi.fn().mockResolvedValue(assessment),
      },
      liveOrder: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'live-order-1', createdAt: now, updatedAt: now, ...data })),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'live-order-1', createdAt: now, updatedAt: now, ...data })),
      },
      livePosition: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new LiveTradingService(
      prisma as never,
      {
        list: vi.fn().mockResolvedValue([connection]),
        get: vi.fn().mockResolvedValue(connection),
        configuration: vi.fn().mockResolvedValue({ positionMode: 'ONE_WAY' }),
        placeOrder,
        instrument: vi.fn().mockResolvedValue({ tickSize: '0.0001', stepSize: '1', minQuantity: '1' }),
      } as never,
      { values: { mode: 'DEMO', approvalTtlMs: 60_000, cooldownMs: 0, runtimeEnabled: true, liveEnabled: true, maxEntryDriftBps: 50 }, assertExecutionAllowed: vi.fn() } as never,
      { record: vi.fn() } as never,
      { values: { maxDrawdown: 0.9, maxLeverage: 10, maxPositions: 10, maxExposure: 1 } } as never,
      { assess: vi.fn() } as never,
      { assessTrade: vi.fn() } as never,
      { ticker: vi.fn() } as never,
    );
    vi.spyOn(service as never, 'sync').mockResolvedValue(undefined);
    vi.spyOn(service as never, 'assertExchangePortfolioRisk').mockResolvedValue({
      positionSize: 100,
      leverage: 2,
      referencePrice: 1.0200,
    });

    const result = await service.executePipeline('user-1', 'run-1');

    expect(result.outcome).toBe('ORDER_SUBMITTED');
    expect(placeOrder).toHaveBeenCalledWith(
      'user-1',
      'conn-demo',
      expect.objectContaining({
        orderType: 'LIMIT',
        limitPrice: '1.01826901',
        timeInForce: 'IOC',
      }),
      expect.anything(),
    );
  });
});
