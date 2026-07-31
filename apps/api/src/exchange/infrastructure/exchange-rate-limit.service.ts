import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { RedisService } from "../../redis/redis.service";
import type {
  ExchangeEnvironment,
  ExchangeProvider,
} from "../domain/exchange.types";

@Injectable()
export class ExchangeRateLimitService {
  private readonly publicEnabled: boolean;
  private readonly privateEnabled: boolean;
  private readonly publicLimit: number;
  private readonly privateLimit: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.publicEnabled =
      config.get<boolean>("EXCHANGE_PUBLIC_RATE_LIMIT_ENABLED") ?? true;
    this.privateEnabled =
      config.get<boolean>("EXCHANGE_PRIVATE_RATE_LIMIT_ENABLED") ?? true;
    this.publicLimit =
      config.get<number>("EXCHANGE_PUBLIC_RATE_LIMIT_PER_MINUTE") ?? 1200;
    this.privateLimit =
      config.get<number>("EXCHANGE_PRIVATE_RATE_LIMIT_PER_MINUTE") ?? 300;
  }

  async public(
    provider: ExchangeProvider,
    environment: ExchangeEnvironment,
  ): Promise<void> {
    if (this.publicEnabled)
      await this.consume(
        this.publicKey(provider, environment),
        this.publicLimit,
      );
  }

  async private(
    provider: ExchangeProvider,
    environment: ExchangeEnvironment,
    userId: string,
    connectionId: string,
  ): Promise<void> {
    if (this.privateEnabled) {
      await this.consume(
        this.privateKey(provider, environment, userId, connectionId),
        this.privateLimit,
      );
    }
  }

  publicKey(
    provider: ExchangeProvider,
    environment: ExchangeEnvironment,
  ): string {
    return `exchange:rate:public:${provider}:${environment}`;
  }

  privateKey(
    provider: ExchangeProvider,
    environment: ExchangeEnvironment,
    userId: string,
    connectionId: string,
  ): string {
    return `exchange:rate:private:${provider}:${environment}:${userId}:${connectionId}`;
  }

  private async consume(key: string, limit: number): Promise<void> {
    if ((await this.redis.incrementWithTtl(key, 60)) > limit) {
      throw new HttpException(
        "Local exchange rate limit exceeded",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
