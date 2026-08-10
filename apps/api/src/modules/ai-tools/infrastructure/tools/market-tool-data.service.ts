import { Injectable } from '@nestjs/common';
import { ExchangeInterval, ExchangeProvider } from '../../../../exchange/domain/exchange.types';
import { PublicExchangeService } from '../../../../exchange/application/public-exchange.service';
import { normalizeSymbol } from '../../../../exchange/infrastructure/exchange-symbol';
import { MarketDataService } from '../../../../market-data/application/market-data.service';
import { MarketDataRepository } from '../../../../market-data/infrastructure/persistence/market-data.repository';
import { MarketRedisCacheService } from '../../../../market-data/infrastructure/redis/market-redis-cache.service';

@Injectable()
export class MarketToolDataService {
  constructor(
    private readonly marketData: MarketDataService,
    private readonly cache: MarketRedisCacheService,
    private readonly repository: MarketDataRepository,
    private readonly publicExchange: PublicExchangeService,
  ) {}

  private provider(value?: string): ExchangeProvider {
    return (value || ExchangeProvider.BINANCE_FUTURES) as ExchangeProvider;
  }

  async ticker(symbol: string, provider?: string) {
    const selectedProvider = this.provider(provider);
    const normalized = normalizeSymbol(symbol);
    return (
      (await this.cache.getTicker(selectedProvider, normalized)) ??
      this.publicExchange.ticker(selectedProvider, normalized)
    );
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

  async funding(symbol: string, provider?: string) {
    const selectedProvider = this.provider(provider);
    const normalized = normalizeSymbol(symbol);
    const history = await this.repository.getFundingRates({
      provider: selectedProvider,
      symbol: normalized,
      limit: 3,
    });
    if (history.length > 0) return history;

    const current = await this.publicExchange.funding(selectedProvider, normalized);
    await this.repository.upsertFundingRate(current);
    return [current];
  }

  async openInterest(symbol: string, provider?: string) {
    const selectedProvider = this.provider(provider);
    const normalized = normalizeSymbol(symbol);
    const history = await this.repository.getOpenInterestHistory({
      provider: selectedProvider,
      symbol: normalized,
      limit: 3,
    });
    if (history.length > 0) return history;

    const current = await this.publicExchange.openInterest(selectedProvider, normalized);
    await this.repository.upsertOpenInterest(current);
    return [current];
  }

  async orderBook(symbol: string, provider: string | undefined, depth: number) {
    const selectedProvider = this.provider(provider);
    const normalized = normalizeSymbol(symbol);
    return (
      (await this.cache.getOrderBook(selectedProvider, normalized, depth)) ??
      this.publicExchange.orderBook(selectedProvider, normalized, depth)
    );
  }
}
