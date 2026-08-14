import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { RedisService } from "../../redis/redis.service";
import type { ExchangeProvider } from "../domain/exchange.types";

@Injectable()
export class ExchangeCacheService {
  readonly instrumentTtl: number;
  readonly tickerTtl: number;
  private readonly inFlight = new Map<string, Promise<unknown>>();

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

    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<T>;

    const loadPromise = (async () => {
      // Recheck after joining the local single-flight boundary. Another API
      // request may have populated Redis while the first lookup was running.
      const refreshed = await this.redis.get(key);
      if (refreshed) return JSON.parse(refreshed) as T;
      const value = await loader();
      await this.redis.setWithTtl(key, JSON.stringify(value), ttlSeconds);
      return value;
    })();
    this.inFlight.set(key, loadPromise);
    try {
      return await loadPromise;
    } finally {
      if (this.inFlight.get(key) === loadPromise) this.inFlight.delete(key);
    }
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
