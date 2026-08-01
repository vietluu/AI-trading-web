import { Injectable } from '@nestjs/common';
import { ExchangeInterval, ExchangeProvider } from '../../../../exchange/domain/exchange.types';
import { MarketDataService } from '../../../../market-data/application/market-data.service';
import { MarketDataRepository } from '../../../../market-data/infrastructure/persistence/market-data.repository';
import { MarketRedisCacheService } from '../../../../market-data/infrastructure/redis/market-redis-cache.service';

@Injectable()
export class MarketToolDataService {
  constructor(
    private readonly marketData: MarketDataService,
    private readonly cache: MarketRedisCacheService,
    private readonly repository: MarketDataRepository,
  ) {}

  private provider(value?: string): ExchangeProvider {
    return (value || ExchangeProvider.BINANCE_FUTURES) as ExchangeProvider;
  }

  ticker(symbol: string, provider?: string) {
    return this.cache.getTicker(this.provider(provider), symbol);
  }

  candles(symbol: string, provider: string | undefined, interval: string, limit: number) {
    return this.marketData.getHistoricalCandles({
      provider: this.provider(provider),
      symbol,
      interval: interval as ExchangeInterval,
      limit,
    });
  }

  indicators(symbol: string, provider: string | undefined, interval: string) {
    return this.marketData.getIndicatorSnapshot(
      this.provider(provider),
      symbol,
      interval as ExchangeInterval,
    );
  }

  funding(symbol: string, provider?: string) {
    return this.repository.getFundingRates({
      provider: this.provider(provider),
      symbol,
      limit: 3,
    });
  }

  openInterest(symbol: string, provider?: string) {
    return this.repository.getOpenInterestHistory({
      provider: this.provider(provider),
      symbol,
      limit: 3,
    });
  }

  orderBook(symbol: string, provider: string | undefined, depth: number) {
    return this.cache.getOrderBook(this.provider(provider), symbol, depth);
  }
}
