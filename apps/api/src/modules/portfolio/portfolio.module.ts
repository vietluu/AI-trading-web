import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { SessionModule } from "../../session/session.module";
import { PortfolioConfigService } from "./application/portfolio-config.service";
import { PortfolioRebalanceScheduler } from "./application/portfolio-rebalance.scheduler";
import { PortfolioService } from "./application/portfolio.service";
import { PortfolioController } from "./presentation/portfolio.controller";

@Module({
  imports: [DatabaseModule, SessionModule],
  controllers: [PortfolioController],
  providers: [
    PortfolioConfigService,
    PortfolioService,
    PortfolioRebalanceScheduler,
  ],
  exports: [PortfolioConfigService, PortfolioService],
})
export class PortfolioModule {}
