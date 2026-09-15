import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinanceFuturesAdapter } from '../../src/exchange/infrastructure/binance/binance-futures.adapter';
import { OkxFuturesAdapter } from '../../src/exchange/infrastructure/okx/okx-futures.adapter';
import { ExchangeEnvironment } from '../../src/exchange/domain/exchange.types';

const now = new Date('2026-09-09T12:00:00Z');
const credentials = { apiKey: 'fixture', apiSecret: 'fixture', passphrase: 'fixture', environment: ExchangeEnvironment.DEMO };
const command = { symbol: 'BTC-USDT', side: 'BUY', quantity: '0.02', leverage: 2, clientOrderId: 'thesis1', orderType: 'LIMIT', limitPrice: '108200', timeInForce: 'IOC', expiresAt: '2026-09-09T12:15:00Z' } as const;
function fixture(provider: 'BINANCE' | 'OKX') {
  const signedPost = vi.fn((path: string, _credentials: unknown, body?: Record<string, unknown>) => {
    if (path.includes('leverage')) return Promise.resolve([{ lever: '2' }]);
    if (provider === 'BINANCE') return Promise.resolve({ symbol: 'BTCUSDT', orderId: '1', side: 'BUY', type: body?.type, status: 'NEW', origQty: '0.02', executedQty: '0', price: body?.price, timeInForce: body?.timeInForce });
    return Promise.resolve([{ ordId: '1', clOrdId: 'thesis1', sCode: '0', sMsg: '' }]);
  });
  const client = { signedPost, signedGet: () => Promise.resolve([{ instId: 'BTC-USDT-SWAP', maxBuy: '100', maxSell: '100' }]), publicGet: () => Promise.resolve([{ instId: 'BTC-USDT-SWAP', last: '108250', bidPx: '108249', askPx: '108251', high24h: '109000', low24h: '100000', vol24h: '100', volCcy24h: '1000', open24h: '108000', ts: String(now.getTime()) }]) };
  const adapter = provider === 'BINANCE' ? new BinanceFuturesAdapter(client as never) : new OkxFuturesAdapter(client as never);
  vi.spyOn(adapter, 'getInstruments').mockResolvedValue([{ symbol: 'BTC-USDT', contractSize: '0.01', tickSize: '0.1', stepSize: '1', minQuantity: '1', quantityPrecision: 0, pricePrecision: 1, supportsLimitOrder: true }] as never);
  return { adapter, signedPost };
}
describe('proactive LIMIT execution adapters', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());
  it.each(['BINANCE', 'OKX'] as const)('%s keeps a scheduled pullback limit resting until local expiry', async (provider) => {
    const { adapter, signedPost } = fixture(provider);
    await adapter.placeOrder(credentials, { ...command, timeInForce: 'GTC' } as never);
    const orders = signedPost.mock.calls.filter(([path]) => path.endsWith('/order'));
    expect(orders).toHaveLength(1);
    expect(orders[0]?.[2]).toMatchObject(provider === 'BINANCE'
      ? { type: 'LIMIT', price: '108200', timeInForce: 'GTC' }
      : { ordType: 'limit', px: '108200' });
  });
  it.each(['BINANCE', 'OKX'] as const)('%s submits the declared limit once without market fallback', async (provider) => {
    const { adapter, signedPost } = fixture(provider);
    await adapter.placeOrder(credentials, command);
    const orders = signedPost.mock.calls.filter(([path]) => path.endsWith('/order'));
    expect(orders).toHaveLength(1);
    expect(orders[0]?.[2]).toMatchObject(provider === 'BINANCE' ? { type: 'LIMIT', price: '108200', timeInForce: 'IOC' } : { ordType: 'ioc', px: '108200' });
  });
  it.each(['BINANCE', 'OKX'] as const)('%s refuses an expired thesis before any exchange mutation', async (provider) => {
    const { adapter, signedPost } = fixture(provider);
    await expect(adapter.placeOrder(credentials, { ...command, expiresAt: now.toISOString() })).rejects.toThrow('THESIS_ORDER_EXPIRED');
    expect(signedPost).not.toHaveBeenCalled();
  });
  it('does not retry a governed OKX limit as market when the exchange rejects it', async () => {
    const { adapter, signedPost } = fixture('OKX');
    signedPost.mockImplementation(((path: string) => Promise.resolve(path.includes('leverage') ? [{ lever: '2' }] : [{ ordId: '1', clOrdId: 'thesis1', sCode: '1', sMsg: 'All operations failed' }])) as never);
    await expect(adapter.placeOrder(credentials, command)).rejects.toThrow('All operations failed');
    expect(signedPost.mock.calls.filter(([path]) => path.endsWith('/order'))).toHaveLength(1);
  });
  it.each(['BINANCE', 'OKX'] as const)('%s rechecks deadline after exchange preflight IO', async (provider) => {
    const { adapter, signedPost } = fixture(provider);
    const prior = signedPost.getMockImplementation()!;
    signedPost.mockImplementation((async (path: string, creds: unknown, body?: Record<string, unknown>) => {
      const result = await prior(path, creds, body);
      if (path.includes('leverage')) vi.setSystemTime(new Date(command.expiresAt));
      return result;
    }) as never);
    await expect(adapter.placeOrder(credentials, command)).rejects.toThrow('THESIS_ORDER_EXPIRED');
    expect(signedPost.mock.calls.filter(([path]) => path.endsWith('/order'))).toHaveLength(0);
  });

});
