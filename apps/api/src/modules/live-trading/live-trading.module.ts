import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { ExchangeModule } from "../../exchange/exchange.module";
import { RiskModule } from "../risk/risk.module";
import { PortfolioModule } from "../portfolio/portfolio.module";
import { LiveTradingConfigService } from "./application/live-trading-config.service";
import { LiveTradingSyncService } from "./application/live-trading-sync.service";
import { LiveTradingService } from "./application/live-trading.service";
import { LiveTradingController } from "./presentation/live-trading.controller";
import { LiveTradingGateway } from "./presentation/live-trading.gateway";

@Module({
  imports: [AuthModule, ExchangeModule, RiskModule, PortfolioModule],
  controllers: [LiveTradingController],
  providers: [
    LiveTradingConfigService,
    LiveTradingService,
    LiveTradingSyncService,
    LiveTradingGateway,
  ],
  exports: [LiveTradingService, LiveTradingConfigService],
})
export class LiveTradingModule {}
