import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { resolve } from "node:path";
import { BullModule } from "@nestjs/bullmq";

import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { validateEnvironment } from "./config/environment";
import { CredentialModule } from "./credentials/credential.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { ExchangeModule } from "./exchange/exchange.module";
import { MarketDataModule } from "./market-data/market-data.module";
import { ExternalDataModule } from "./modules/external-data/external-data.module";
import { AIModule } from "./modules/ai/ai.module";
import { AIToolsModule } from "./modules/ai-tools/ai-tools.module";
import { AgentsModule } from "./modules/agents/agents.module";
import { RedisModule } from "./redis/redis.module";
import { PipelineModule } from "./modules/pipeline/pipeline.module";
import { SessionModule } from "./session/session.module";
import { SettingsModule } from "./settings/settings.module";
import { ReflectionModule } from "./modules/reflection/reflection.module";
import { RiskModule } from "./modules/risk/risk.module";
import { LiveTradingModule } from "./modules/live-trading/live-trading.module";
import { PortfolioModule } from "./modules/portfolio/portfolio.module";
import { ResearchModule } from "./modules/research/research.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: [
        resolve(__dirname, "../../../.env"),
        resolve(__dirname, "../.env"),
      ],
      isGlobal: true,
      validate: validateEnvironment,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379' },
      }),
    }),
    DatabaseModule,
    RedisModule,
    AuditModule,
    SessionModule,
    HealthModule,
    AuthModule,
    CredentialModule,
    SettingsModule,
    ExchangeModule,
    MarketDataModule,
    ExternalDataModule,
    AIModule,
    AIToolsModule,
    AgentsModule,
    PipelineModule,
    ReflectionModule,
    RiskModule,
    PortfolioModule,
    ResearchModule,
    LiveTradingModule,
  ],
})
export class AppModule {}
