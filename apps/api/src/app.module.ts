import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { resolve } from "node:path";

import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { validateEnvironment } from "./config/environment";
import { CredentialModule } from "./credentials/credential.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { ExchangeModule } from "./exchange/exchange.module";
import { RedisModule } from "./redis/redis.module";
import { SessionModule } from "./session/session.module";
import { SettingsModule } from "./settings/settings.module";

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
    DatabaseModule,
    RedisModule,
    AuditModule,
    SessionModule,
    HealthModule,
    AuthModule,
    CredentialModule,
    SettingsModule,
    ExchangeModule,
  ],
})
export class AppModule {}
