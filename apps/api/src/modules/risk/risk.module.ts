import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { SessionModule } from "../../session/session.module";
import { ExchangeModule } from "../../exchange/exchange.module";
import { RiskConfigService } from "./application/risk-config.service";
import { RiskManagementService } from "./application/risk-management.service";
import { RiskController } from "./presentation/risk.controller";

@Module({
  imports: [DatabaseModule, SessionModule, ExchangeModule],
  controllers: [RiskController],
  providers: [RiskConfigService, RiskManagementService],
  exports: [RiskConfigService, RiskManagementService],
})
export class RiskModule {}
