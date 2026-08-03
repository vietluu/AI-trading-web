import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(configService: ConfigService) {
    this.client = new Redis(configService.getOrThrow<string>("REDIS_URL"), {
      enableReadyCheck: true,
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });

    this.client.on("error", (error: Error) => {
      this.logger.error({
        event: "redis_error",
        message: error.message,
      });
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    await this.checkConnection();
    this.logger.log({ event: "redis_connected" });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async checkConnection(): Promise<void> {
    await this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async getAndDelete(key: string): Promise<string | null> {
    return this.client.getdel(key);
  }

  async setWithTtl(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.set(key, value, "EX", ttlSeconds);
  }

  async delete(...keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.client.expire(key, ttlSeconds)) === 1;
  }

   async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return count;
  }
}
