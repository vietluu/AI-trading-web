import { describe, expect, it, vi } from 'vitest';
import { affectsSymbol, EventPipelineService, freshEvent } from '../../src/modules/pipeline/application/event-pipeline.service';
import type { SharedMarketEvent } from '../../src/modules/pipeline/application/event-pipeline.service';
import { EventSubscribersService } from '../../src/modules/pipeline/application/event-subscribers.service';

const news = (): SharedMarketEvent => ({ id: 'news-1', kind: 'NEWS',
  occurredAt: new Date().toISOString(), symbols: ['BTC'], evidence: {} });

describe('event pipeline', () => {
  it('rejects stale, invalid and future events', () => {
    expect(freshEvent({ ...news(), occurredAt: 'invalid' })).toBe(false);
    expect(freshEvent({ ...news(), occurredAt: new Date(Date.now() - 301_000).toISOString() })).toBe(false);
    expect(freshEvent({ ...news(), occurredAt: new Date(Date.now() + 10_000).toISOString() })).toBe(false);
    expect(freshEvent(news())).toBe(true);
  });

  it('routes exact assets without confusing BTC with BTCDOM', () => {
    expect(affectsSymbol(news(), 'BTC-USDT')).toBe(true);
    expect(affectsSymbol(news(), 'ETH-USDT')).toBe(false);
    expect(affectsSymbol(news(), 'BTCDOM-USDT')).toBe(false);
    expect(affectsSymbol({ ...news(), kind: 'MACRO', symbols: [] }, 'ETH-USDT')).toBe(true);
  });

  it('finds active subscribers without querying schedules and coalesces scope reads', async () => {
    const findMany = vi.fn(() => Promise.resolve([{ id: 'u1', setting: { preferredSymbols: ['BTC-USDT'], preferredExchange: 'OKX' },
      portfolioStrategies: [{ key: 'trend', symbols: ['BTC-USDT', 'ETH-USDT'] }],
      exchangeConnections: [{ provider: 'OKX_FUTURES' }, { provider: 'OKX_FUTURES' }] }]));
    const subscribers = new EventSubscribersService({ user: { findMany } } as never);
    const [a, b] = await Promise.all([subscribers.list(), subscribers.list()]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(a).toEqual([{ userId: 'u1', symbol: 'BTC-USDT', provider: 'OKX_FUTURES', strategyIds: ['trend'] }]);
    expect(b).toEqual(a);
  });

  it('routes an event through opportunity discovery and the mandatory thesis lifecycle only', async () => {
    const legacyTrigger = vi.fn();
    const scheduleProactiveThesis = vi.fn().mockResolvedValue({ status: 'SCHEDULED', runId: 'run' });
    const cutoff = new Date('2026-10-05T10:15:00.000Z');
    const observe = vi.fn().mockResolvedValue({
      opportunityId: 'opportunity-1', snapshotId: 'snapshot-1', state: 'WATCHING',
      duplicate: false, reasonCode: 'SETUP_DETECTED',
    });
    const service = new EventPipelineService({} as never, {} as never, {} as never,
      { reserveAnchor: vi.fn().mockResolvedValue({ run: true, sourceDataCutoff: cutoff }) } as never,
      { list: () => Promise.resolve([{ userId: 'u1', symbol: 'BTC-USDT', provider: 'OKX_FUTURES', strategyIds: ['trend'] }]) } as never,
      { trigger: legacyTrigger, scheduleProactiveThesis } as never, { enabled: true } as never,
      {} as never, { observe } as never);
    const event = news();

    await service.dispatch(event);

    expect(legacyTrigger).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith({
      userId: 'u1', provider: 'OKX_FUTURES', symbol: 'BTC-USDT', timeframe: '15m',
      sourceDataCutoff: cutoff,
    });
    expect(scheduleProactiveThesis.mock.calls[0]?.[0]).toMatchObject({
      userId: 'u1',
      request: {
        pipelineId: 'proactive-thesis', symbol: 'BTC-USDT', provider: 'OKX_FUTURES',
        params: {
          opportunityId: 'opportunity-1', snapshotId: 'snapshot-1',
          sourceDataCutoff: cutoff.toISOString(), systemEventId: 'news-1',
        },
      },
    });
  });

  it('does not queue a thesis when observation finishes after the event expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T10:00:00.000Z'));
    try {
      const scheduleProactiveThesis = vi.fn();
      const service = new EventPipelineService({} as never, {} as never, {} as never,
        { reserveAnchor: vi.fn().mockResolvedValue({ run: true, sourceDataCutoff: new Date() }) } as never,
        { list: () => Promise.resolve([{ userId: 'u1', symbol: 'BTC-USDT', provider: 'OKX_FUTURES', strategyIds: ['trend'] }]) } as never,
        { scheduleProactiveThesis } as never, { enabled: true } as never, {} as never,
        { observe: vi.fn().mockImplementation(() => {
          vi.setSystemTime(new Date('2026-10-05T10:05:01.000Z'));
          return Promise.resolve({ opportunityId: 'opp', snapshotId: 'snapshot', state: 'WATCHING' });
        }) } as never);

      await service.dispatch(news());

      expect(scheduleProactiveThesis).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not spend AI when deterministic observation has no watchable setup', async () => {
    const scheduleProactiveThesis = vi.fn();
    const service = new EventPipelineService({} as never, {} as never, {} as never,
      { reserveAnchor: vi.fn().mockResolvedValue({ run: true, sourceDataCutoff: new Date() }) } as never,
      { list: () => Promise.resolve([{ userId: 'u1', symbol: 'BTC-USDT', provider: 'OKX_FUTURES', strategyIds: ['trend'] }]) } as never,
      { scheduleProactiveThesis } as never, { enabled: true } as never, {} as never,
      { observe: vi.fn().mockResolvedValue({ opportunityId: null, snapshotId: 'snapshot', state: null }) } as never);

    await service.dispatch(news());

    expect(scheduleProactiveThesis).not.toHaveBeenCalled();
  });

  it('accepts trusted market-wide news and rejects lookalike domains and custom feeds', async () => {
    const add = vi.fn();
    const source = { isEnabled: true, isCustom: false, reliabilityScore: 90, baseDomain: 'reuters.com' };
    const service = new EventPipelineService({ add } as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, { enabled: true } as never,
      { externalDataSource: { findUnique: () => Promise.resolve(source) } } as never);
    const event = { id: 'article', title: 'Macro news', importanceScore: 90,
      publishedAt: new Date().toISOString(), symbols: [], topics: ['macro'],
      sourceId: 'reuters', canonicalUrl: 'https://www.reuters.com/story', reliabilityScore: 90 };
    await service.acceptNews(event);
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0]?.[1]).toMatchObject({ marketWide: true });
    await service.acceptNews({ ...event, canonicalUrl: 'https://reuters.com.evil.invalid/story' });
    source.isCustom = true;
    await service.acceptNews(event);
    expect(add).toHaveBeenCalledOnce();
  });
});
