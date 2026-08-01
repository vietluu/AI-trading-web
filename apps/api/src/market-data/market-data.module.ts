import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { MarketDataConfigService } from './application/market-data-config.service';
import { MarketDataService } from './application/market-data.service';
import { MarketStreamManager } from './application/market-stream.manager';
import { MarketBackfillService } from './application/market-backfill.service';
import { MarketPollingScheduler } from './application/market-polling.scheduler';
import { MarketPollingProcessor } from './infrastructure/queues/market-polling.processor';
import { MarketEventBus } from './infrastructure/event-bus/market-event-bus';
import { MarketRedisCacheService } from './infrastructure/redis/market-redis-cache.service';
import { MarketDataRepository } from './infrastructure/persistence/market-data.repository';
import { BinancePublicStreamAdapter } from './infrastructure/streams/binance-public-stream.adapter';
import { OkxPublicStreamAdapter } from './infrastructure/streams/okx-public-stream.adapter';
import { MarketDataController } from './presentation/market-data.controller';
import { MarketDataGateway } from './presentation/market-data.gateway';

@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get('REDIS_URL') || 'redis://localhost:6379',
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'market-polling',
    }),
  ],
  controllers: [MarketDataController],
  providers: [
    MarketDataConfigService,
    MarketDataService,
    MarketStreamManager,
    MarketBackfillService,
    MarketPollingScheduler,
    MarketPollingProcessor,
    MarketEventBus,
    MarketRedisCacheService,
    MarketDataRepository,
    BinancePublicStreamAdapter,
    OkxPublicStreamAdapter,
    MarketDataGateway,
  ],
  exports: [
    MarketEventBus,
    MarketRedisCacheService,
    MarketDataConfigService,
    MarketDataRepository,
    MarketBackfillService,
  ],
})
export class MarketDataModule {}
