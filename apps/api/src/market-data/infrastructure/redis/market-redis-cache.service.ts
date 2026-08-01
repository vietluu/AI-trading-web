import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import type { ExchangeProvider } from '../../../exchange/domain/exchange.types';
import type {
  NormalizedTicker,
  NormalizedCandle,
  NormalizedFundingRate,
  NormalizedOpenInterest,
  NormalizedOrderBook,
  MarketStreamStatus,
  IndicatorSnapshot,
} from '../../domain/market-data.types';

@Injectable()
export class MarketRedisCacheService {
  private readonly logger = new Logger(MarketRedisCacheService.name);

  constructor(private readonly redisService: RedisService) {}

  private getCachedPayload<T>(data: T) {
    return {
      ...data,
      cachedAt: new Date().toISOString(),
      version: 1,
    };
  }

  private parseCachedPayload<T>(data: string): T {
    try {
      return JSON.parse(data, (key, value) => {
        // Parse ISO string dates
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
          return new Date(value);
        }
        return value;
      }) as T;
    } catch (error) {
      this.logger.error('Failed to parse cached payload', error);
      return JSON.parse(data) as T;
    }
  }

  // Setters
  async setTicker(provider: ExchangeProvider, symbol: string, ticker: NormalizedTicker): Promise<void> {
    const key = `market:ticker:${provider}:${symbol}`;
    await this.redisService.setWithTtl(key, JSON.stringify(this.getCachedPayload(ticker)), 30);
  }

  async setCandle(provider: ExchangeProvider, symbol: string, interval: string, candle: NormalizedCandle): Promise<void> {
    const key = `market:candle:${provider}:${symbol}:${interval}`;
    let ttl = 300;
    if (interval.endsWith('m')) ttl = parseInt(interval, 10) * 60;
    else if (interval.endsWith('h')) ttl = parseInt(interval, 10) * 3600;
    else if (interval.endsWith('d')) ttl = parseInt(interval, 10) * 86400;
    
    await this.redisService.setWithTtl(key, JSON.stringify(this.getCachedPayload(candle)), ttl);
  }

  async setFunding(provider: ExchangeProvider, symbol: string, fundingRate: NormalizedFundingRate): Promise<void> {
    const key = `market:funding:${provider}:${symbol}`;
    await this.redisService.setWithTtl(key, JSON.stringify(this.getCachedPayload(fundingRate)), 900);
  }

  async setOpenInterest(provider: ExchangeProvider, symbol: string, openInterest: NormalizedOpenInterest): Promise<void> {
    const key = `market:open-interest:${provider}:${symbol}`;
    await this.redisService.setWithTtl(key, JSON.stringify(this.getCachedPayload(openInterest)), 300);
  }

  async setOrderBook(provider: ExchangeProvider, symbol: string, depth: number, orderBook: NormalizedOrderBook): Promise<void> {
    const key = `market:order-book:${provider}:${symbol}:${depth}`;
    await this.redisService.setWithTtl(key, JSON.stringify(this.getCachedPayload(orderBook)), 30);
  }

  async setStreamStatus(provider: ExchangeProvider, status: MarketStreamStatus): Promise<void> {
    const key = `market:stream-status:${provider}`;
    await this.redisService.setWithTtl(key, JSON.stringify(this.getCachedPayload(status)), 60);
  }

  async setIndicator(provider: ExchangeProvider, symbol: string, interval: string, snapshot: IndicatorSnapshot): Promise<void> {
    const key = `market:indicator:${provider}:${symbol}:${interval}`;
    await this.redisService.setWithTtl(key, JSON.stringify(this.getCachedPayload(snapshot)), 300);
  }

  // Getters
  async getTicker(provider: ExchangeProvider, symbol: string): Promise<NormalizedTicker | null> {
    const key = `market:ticker:${provider}:${symbol}`;
    const data = await this.redisService.get(key);
    return data ? this.parseCachedPayload<NormalizedTicker>(data) : null;
  }

  async getCandle(provider: ExchangeProvider, symbol: string, interval: string): Promise<NormalizedCandle | null> {
    const key = `market:candle:${provider}:${symbol}:${interval}`;
    const data = await this.redisService.get(key);
    return data ? this.parseCachedPayload<NormalizedCandle>(data) : null;
  }

  async getFundingRate(provider: ExchangeProvider, symbol: string): Promise<NormalizedFundingRate | null> {
    const key = `market:funding:${provider}:${symbol}`;
    const data = await this.redisService.get(key);
    return data ? this.parseCachedPayload<NormalizedFundingRate>(data) : null;
  }

  async getOpenInterest(provider: ExchangeProvider, symbol: string): Promise<NormalizedOpenInterest | null> {
    const key = `market:open-interest:${provider}:${symbol}`;
    const data = await this.redisService.get(key);
    return data ? this.parseCachedPayload<NormalizedOpenInterest>(data) : null;
  }

  async getOrderBook(provider: ExchangeProvider, symbol: string, depth: number): Promise<NormalizedOrderBook | null> {
    const key = `market:order-book:${provider}:${symbol}:${depth}`;
    const data = await this.redisService.get(key);
    return data ? this.parseCachedPayload<NormalizedOrderBook>(data) : null;
  }

  async getStreamStatus(provider: ExchangeProvider): Promise<MarketStreamStatus | null> {
    const key = `market:stream-status:${provider}`;
    const data = await this.redisService.get(key);
    return data ? this.parseCachedPayload<MarketStreamStatus>(data) : null;
  }

  async getIndicator(provider: ExchangeProvider, symbol: string, interval: string): Promise<IndicatorSnapshot | null> {
    const key = `market:indicator:${provider}:${symbol}:${interval}`;
    const data = await this.redisService.get(key);
    return data ? this.parseCachedPayload<IndicatorSnapshot>(data) : null;
  }
}
