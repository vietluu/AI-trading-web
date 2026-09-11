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
