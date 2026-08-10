import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { EXTERNAL_DATA_QUEUE_NAME } from './infrastructure/queues/external-data-queue.constants';
import { ExternalHttpClient } from './infrastructure/http/external-http-client';
import { GenericRssAdapter } from './infrastructure/providers/rss/generic-rss.adapter';
import { BinanceAnnouncementAdapter } from './infrastructure/providers/binance/binance-announcement.adapter';
import { OkxAnnouncementAdapter } from './infrastructure/providers/okx/okx-announcement.adapter';
import { AlternativeMeFearGreedAdapter } from './infrastructure/providers/fear-greed/alternative-me-fear-greed.adapter';
import { RedditAdapter } from './infrastructure/providers/reddit/reddit.adapter';
import { ManualMacroAdapter } from './infrastructure/providers/macro/manual-macro.adapter';
import { UrlCanonicalizer } from './application/services/url-canonicalizer.service';
import { DeduplicationService } from './application/services/deduplication.service';
import { MetadataExtractor } from './application/services/metadata-extractor.service';
import { DeterministicImportanceScorer } from './application/services/deterministic-importance-scorer.service';
import { NewsIngestionService } from './application/services/news-ingestion.service';
import { UserNewsStateService } from './application/services/user-news-state.service';
import { ProviderHealthService } from './application/services/provider-health.service';
import { MacroImportService } from './application/services/macro-import.service';
import { ExternalDataEventPublisher } from './application/services/external-data-event-publisher.service';
import { ExternalDataIngestionProcessor } from './application/jobs/external-data-ingestion.processor';
import { ExternalDataSchedulerService } from './application/jobs/external-data-scheduler.service';
import { NewsController } from './presentation/controllers/news.controller';
import { AnnouncementsController } from './presentation/controllers/announcements.controller';
import { IncidentsController } from './presentation/controllers/incidents.controller';
import { SentimentController } from './presentation/controllers/sentiment.controller';
import { SocialController } from './presentation/controllers/social.controller';
import { MacroController } from './presentation/controllers/macro.controller';
import { ProvidersController } from './presentation/controllers/providers.controller';
import { SourcesController } from './presentation/controllers/sources.controller';
import { ExternalDataGateway } from './presentation/gateways/external-data.gateway';

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({
      name: EXTERNAL_DATA_QUEUE_NAME,
    }),
  ],
  controllers: [
    NewsController,
    AnnouncementsController,
    IncidentsController,
    SentimentController,
    SocialController,
    MacroController,
    ProvidersController,
    SourcesController,
  ],
  providers: [
    ExternalHttpClient,
    GenericRssAdapter,
    BinanceAnnouncementAdapter,
    OkxAnnouncementAdapter,
    AlternativeMeFearGreedAdapter,
    RedditAdapter,
    ManualMacroAdapter,
    UrlCanonicalizer,
    DeduplicationService,
    MetadataExtractor,
    DeterministicImportanceScorer,
    NewsIngestionService,
    UserNewsStateService,
    ProviderHealthService,
    MacroImportService,
    ExternalDataEventPublisher,
    ExternalDataIngestionProcessor,
    ExternalDataSchedulerService,
    ExternalDataGateway,
  ],
  exports: [
    ExternalHttpClient,
    ExternalDataIngestionProcessor,
    NewsIngestionService,
    UserNewsStateService,
    ProviderHealthService,
    MacroImportService,
    ExternalDataEventPublisher,
  ],
})
export class ExternalDataModule {}
