import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { RedisService } from "../../redis/redis.service";
import type { ExchangeProvider } from "../domain/exchange.types";

@Injectable()
export class ExchangeCacheService {
  readonly instrumentTtl: number;
  readonly tickerTtl: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.instrumentTtl =
      config.get<number>("EXCHANGE_INSTRUMENT_CACHE_TTL_SECONDS") ?? 3600;
    this.tickerTtl =
      config.get<number>("EXCHANGE_TICKER_CACHE_TTL_SECONDS") ?? 3;
  }

  async remember<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as T;
    const value = await loader();
    await this.redis.setWithTtl(key, JSON.stringify(value), ttlSeconds);
    return value;
  }

  instrumentsKey(provider: ExchangeProvider): string {
    return `exchange:instruments:${provider}:PRODUCTION`;
  }

  tickerKey(provider: ExchangeProvider, symbol: string): string {
    return `exchange:ticker:${provider}:${symbol}`;
  }

  fundingKey(provider: ExchangeProvider, symbol: string): string {
    return `exchange:funding:${provider}:${symbol}`;
  }

  openInterestKey(provider: ExchangeProvider, symbol: string): string {
    return `exchange:open-interest:${provider}:${symbol}`;
  }
}
