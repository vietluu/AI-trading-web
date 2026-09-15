import { describe, expect, it, vi } from 'vitest';
import { isRestingEntryExpired } from '../../src/modules/live-trading/domain/resting-limit-expiry';
import { LiveTradingService } from '../../src/modules/live-trading/application/live-trading.service';
import { ExchangeProvider } from '../../src/exchange/domain/exchange.types';

describe('resting entry expiry', () => {
  const order = { type: 'LIMIT', purpose: 'OPEN', reduceOnly: false,
    tradePlan: { timeInForce: 'GTC', expiresAt: '2026-09-15T15:00:00Z' } };
  it('expires at the persisted deadline, without resetting TTL on sync', () => {
    expect(isRestingEntryExpired(order, Date.parse('2026-09-15T14:59:59Z'))).toBe(false);
    expect(isRestingEntryExpired(order, Date.parse('2026-09-15T15:00:00Z'))).toBe(true);
  });
  it('does not cancel protective exits or immediate orders', () => {
    const now = Date.parse('2026-09-15T15:01:00Z');
    expect(isRestingEntryExpired({ ...order, reduceOnly: true }, now)).toBe(false);
    expect(isRestingEntryExpired({ ...order, purpose: 'CLOSE' }, now)).toBe(false);
    expect(isRestingEntryExpired({ ...order, tradePlan: { ...order.tradePlan, timeInForce: 'IOC' } }, now)).toBe(false);
    expect(isRestingEntryExpired({ ...order, tradePlan: null }, now)).toBe(false);
  });

  it.each([false, true])('sync cancels expired entries, preserving exchange state when cancellation fails=%s', async (failure) => {
    const localOrder = { ...order, tradePlan: { ...order.tradePlan, expiresAt: new Date(Date.now() - 1000).toISOString() },
      id: 'local-1', symbol: 'BTC-USDT',
      exchangeOrderId: 'exchange-1', clientOrderId: 'client-1' };
    const exchangeOrder = { exchangeOrderId: 'exchange-1', clientOrderId: 'client-1',
      symbol: 'BTC-USDT', status: 'NEW', originalQuantity: '2', executedQuantity: '1' };
    let status = 'NEW';
    const cancelOrder = vi.fn(() => {
      if (failure) return Promise.reject(new Error('exchange timeout'));
      return Promise.resolve({ ...exchangeOrder, status: 'CANCELED' });
    });
    const prisma = {
      liveOrder: {
        findMany: vi.fn((query: { select?: { tradePlan?: boolean } }) => Promise.resolve(query.select?.tradePlan ? [localOrder] : [])),
        updateMany: vi.fn(({ data }: { data: { status: string } }) => { status = data.status; return Promise.resolve({ count: 1 }); }),
      },
      closedTrade: { findMany: () => Promise.resolve([]) },
      livePosition: { findMany: () => Promise.resolve([]) },
      liveAccountSnapshot: { create: () => Promise.resolve({}) },
      $transaction: (run: (tx: unknown) => Promise<unknown>) => run(prisma),
    };
    const connection = { id: 'demo', provider: ExchangeProvider.BINANCE_FUTURES, environment: 'DEMO',
      isEnabled: true, isVerified: true };
    const service = new LiveTradingService(prisma as never, {
      get: () => Promise.resolve(connection), list: () => Promise.resolve([connection]),
      account: () => Promise.resolve({ totalEquity: '1000', availableBalance: '900', totalUnrealizedPnl: '0', totalMarginBalance: '1000' }),
      positions: () => Promise.resolve([]), openOrders: () => Promise.resolve([exchangeOrder]), orderHistory: () => Promise.resolve([]), cancelOrder,
    } as never, { values: { mode: 'DEMO' } } as never, {} as never,
    {} as never, {} as never, {} as never, {} as never);
    await service.sync('user-1', 'demo', {});
    expect(cancelOrder).toHaveBeenCalledWith('user-1', 'demo', {
      symbol: 'BTC-USDT', orderId: 'exchange-1', clientOrderId: 'client-1',
    }, {});
    expect(status).toBe(failure ? 'NEW' : 'PARTIALLY_FILLED_CANCELED');
  });
});
