import { Module } from '@nestjs/common';
import { MarketDataModule } from '../../market-data/market-data.module';
import { ExchangeModule } from '../../exchange/exchange.module';
import { ResearchService } from './application/research.service';
import { ResearchController } from './presentation/research.controller';
import { QuantReportService } from './application/quant-report.service';
import { KnowledgeBaseService } from './application/knowledge-base.service';
import { QuantIntelligenceService } from './application/quant-intelligence.service';
import { QuantIntelligenceController } from './presentation/quant-intelligence.controller';
import { QuantResearchSchedulerService } from './application/quant-research-scheduler.service';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [MarketDataModule, ExchangeModule, RiskModule],
  controllers: [ResearchController, QuantIntelligenceController],
  providers: [
    ResearchService,
    QuantReportService,
    KnowledgeBaseService,
    QuantIntelligenceService,
    QuantResearchSchedulerService,
  ],
  exports: [ResearchService, QuantIntelligenceService],
})
export class ResearchModule {}
