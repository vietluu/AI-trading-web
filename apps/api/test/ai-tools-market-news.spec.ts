import { describe, expect, it, vi } from 'vitest';
import { ExchangeProvider } from '../src/exchange/domain/exchange.types';
import { MarketToolDataService } from '../src/modules/ai-tools/infrastructure/tools/market-tool-data.service';
import { OnChainMetricsGetTool } from '../src/modules/ai-tools/infrastructure/tools/onchain-tools';
import {
  NewsArticlesListTool,
  NewsHighImportanceListTool,
  SentimentMarketGetTool,
  SocialPostsListTool,
} from '../src/modules/ai-tools/infrastructure/tools/news-tools';

describe('AI market and news tool fallbacks', () => {
  it('accepts canonical symbols beyond BTC and ETH', () => {
    const tools = [
      new NewsArticlesListTool({} as never),
      new NewsHighImportanceListTool({} as never),
      new SentimentMarketGetTool({} as never),
      new SocialPostsListTool({} as never),
    ];

    for (const symbol of ['BTC-USDT', 'CRV-USDT', 'ZRO-USDT', 'SUI-USDT']) {
      for (const tool of tools) {
        expect(tool.inputSchema.safeParse({ symbol }).success).toBe(true);
      }
    }
  });

  it('fetches verified on-chain observations and normalizes the asset symbol', async () => {
    const http = {
      fetch: vi.fn().mockResolvedValue({
        body: JSON.stringify({
          data: [{ asset: 'sui', time: '2026-08-09T00:00:00.000Z', TxCnt: '1234' }],
        }),
      }),
    };
    const tool = new OnChainMetricsGetTool(http as never);
    const output = await tool.execute(
      { symbol: 'SUI-USDT', lookbackHours: 168 },
      {} as never,
    );

    expect(output).toEqual(expect.objectContaining({
      provider: 'COIN_METRICS', asset: 'sui',
    }));
    expect(JSON.stringify(http.fetch.mock.calls)).toContain('assets=sui');
  });

  it('falls back to public REST data and persists derivatives when stream cache is empty', async () => {
    const cache = {
      getTicker: vi.fn().mockResolvedValue(null),
      getOrderBook: vi.fn().mockResolvedValue(null),
    };
    const repository = {
      getFundingRates: vi.fn().mockResolvedValue([]),
      getOpenInterestHistory: vi.fn().mockResolvedValue([]),
      upsertFundingRate: vi.fn().mockResolvedValue(undefined),
      upsertOpenInterest: vi.fn().mockResolvedValue(undefined),
    };
    const ticker = {
      provider: ExchangeProvider.OKX_FUTURES, symbol: 'CRV-USDT',
      lastPrice: '0.5', timestamp: new Date(),
    };
    const orderBook = {
      provider: ExchangeProvider.OKX_FUTURES, symbol: 'CRV-USDT',
      bids: [], asks: [], timestamp: new Date(),
    };
    const funding = {
      provider: ExchangeProvider.OKX_FUTURES, symbol: 'CRV-USDT',
      fundingRate: '0.0001', fundingTime: new Date(),
    };
    const openInterest = {
      provider: ExchangeProvider.OKX_FUTURES, symbol: 'CRV-USDT',
      openInterest: '1000', timestamp: new Date(),
    };
    const publicExchange = {
      ticker: vi.fn().mockResolvedValue(ticker),
      orderBook: vi.fn().mockResolvedValue(orderBook),
      funding: vi.fn().mockResolvedValue(funding),
      openInterest: vi.fn().mockResolvedValue(openInterest),
    };
    const service = new MarketToolDataService(
      {} as never, cache as never, repository as never, publicExchange as never,
    );

    await expect(service.ticker('crv/usdt', 'OKX_FUTURES')).resolves.toBe(ticker);
    await expect(service.orderBook('crv_usdt', 'OKX_FUTURES', 5)).resolves.toBe(orderBook);
    await expect(service.funding('CRV-USDT', 'OKX_FUTURES')).resolves.toEqual([funding]);
    await expect(service.openInterest('CRV-USDT', 'OKX_FUTURES')).resolves.toEqual([openInterest]);
    expect(repository.upsertFundingRate).toHaveBeenCalledWith(funding);
    expect(repository.upsertOpenInterest).toHaveBeenCalledWith(openInterest);
  });
});
