import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { RedisService } from "../../redis/redis.service";
import type {
  ExchangeEnvironment,
  ExchangeProvider,
} from "../domain/exchange.types";

@Injectable()
export class ExchangeTimeService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.ttlSeconds =
      config.get<number>("EXCHANGE_TIME_OFFSET_CACHE_TTL_SECONDS") ?? 300;
  }

  async offset(
    provider: ExchangeProvider,
    environment: ExchangeEnvironment,
    loader: () => Promise<number>,
  ): Promise<number> {
    const key = this.key(provider, environment);
    const cached = await this.redis.get(key);
    if (cached !== null && Number.isFinite(Number(cached)))
      return Number(cached);
    const serverTime = await loader();
    const offset = serverTime - Date.now();
    await this.redis.setWithTtl(key, String(offset), this.ttlSeconds);
    return offset;
  }

  async invalidate(
    provider: ExchangeProvider,
    environment: ExchangeEnvironment,
  ): Promise<void> {
    await this.redis.delete(this.key(provider, environment));
  }

  key(provider: ExchangeProvider, environment: ExchangeEnvironment): string {
    return `exchange:time-offset:${provider}:${environment}`;
  }
}
