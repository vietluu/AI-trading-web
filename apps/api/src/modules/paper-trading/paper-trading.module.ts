import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { ExchangeModule } from "../../exchange/exchange.module";
import { SessionModule } from "../../session/session.module";
import { PaperTradingConfigService } from "./application/paper-trading-config.service";
import { PaperTradingService } from "./application/paper-trading.service";
import { PaperTradingController } from "./presentation/paper-trading.controller";
import { RiskModule } from "../risk/risk.module";
import { PortfolioModule } from "../portfolio/portfolio.module";

@Module({
  imports: [
    DatabaseModule,
    ExchangeModule,
    SessionModule,
    RiskModule,
    PortfolioModule,
  ],
  controllers: [PaperTradingController],
  providers: [PaperTradingConfigService, PaperTradingService],
  exports: [PaperTradingService],
})
export class PaperTradingModule {}
