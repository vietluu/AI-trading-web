import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { SessionModule } from "../../session/session.module";
import { ExchangeModule } from "../../exchange/exchange.module";
import { RiskConfigService } from "./application/risk-config.service";
import { RiskManagementService } from "./application/risk-management.service";
import { RiskController } from "./presentation/risk.controller";

import { DataRetentionService } from "../system/data-retention.service";

@Module({
  imports: [DatabaseModule, SessionModule, ExchangeModule],
  controllers: [RiskController],
  providers: [RiskConfigService, RiskManagementService, DataRetentionService],
  exports: [RiskConfigService, RiskManagementService, DataRetentionService],
})
export class RiskModule {}
