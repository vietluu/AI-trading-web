import { Module } from '@nestjs/common';
import { MarketDataModule } from '../../market-data/market-data.module';
import { ResearchService } from './application/research.service';
import { ResearchController } from './presentation/research.controller';

@Module({
  imports: [MarketDataModule],
  controllers: [ResearchController],
  providers: [ResearchService],
  exports: [ResearchService],
})
export class ResearchModule {}
