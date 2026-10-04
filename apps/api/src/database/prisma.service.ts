import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const databaseUrl = new URL(configService.getOrThrow<string>('DATABASE_URL'));
    if (!databaseUrl.searchParams.has('connection_limit')) {
      const poolSize = Number(configService.get<string>('DATABASE_POOL_SIZE') ?? 10);
      if (!Number.isInteger(poolSize) || poolSize < 1 || poolSize > 20) {
        throw new Error('DATABASE_POOL_SIZE must be an integer from 1 to 20 per process');
      }
      databaseUrl.searchParams.set('connection_limit', String(poolSize));
    }
    // Keep waits bounded; increasing timeout only hides saturation.
    if (!databaseUrl.searchParams.has('pool_timeout')) databaseUrl.searchParams.set('pool_timeout', '10');
    super({
      datasourceUrl: databaseUrl.toString(),
      log: [
        { emit: "stdout", level: "warn" },
        { emit: "stdout", level: "error" },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async checkConnection(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
