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
}
