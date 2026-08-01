import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../../database/prisma.service';
import { EXTERNAL_DATA_QUEUE_NAME, ExternalDataJobType } from '../../infrastructure/queues/external-data-queue.constants';
import { GenericRssAdapter } from '../../infrastructure/providers/rss/generic-rss.adapter';
import { BinanceAnnouncementAdapter } from '../../infrastructure/providers/binance/binance-announcement.adapter';
import { OkxAnnouncementAdapter } from '../../infrastructure/providers/okx/okx-announcement.adapter';
import { AlternativeMeFearGreedAdapter } from '../../infrastructure/providers/fear-greed/alternative-me-fear-greed.adapter';
import { NewsIngestionService } from '../services/news-ingestion.service';
import { ProviderHealthService } from '../services/provider-health.service';
import { ExternalDataEventPublisher } from '../services/external-data-event-publisher.service';

@Processor(EXTERNAL_DATA_QUEUE_NAME)
export class ExternalDataIngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(ExternalDataIngestionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rssAdapter: GenericRssAdapter,
    private readonly binanceAdapter: BinanceAnnouncementAdapter,
    private readonly okxAdapter: OkxAnnouncementAdapter,
    private readonly fearGreedAdapter: AlternativeMeFearGreedAdapter,
    private readonly newsIngestionService: NewsIngestionService,
    private readonly providerHealth: ProviderHealthService,
    private readonly eventPublisher: ExternalDataEventPublisher,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const startTime = Date.now();
    this.logger.debug(`Processing BullMQ job ${job.name} (id: ${job.id})`);

    switch (job.name) {
      case ExternalDataJobType.POLL_RSS_SOURCES:
        return this.handlePollRssSources(startTime);

      case ExternalDataJobType.POLL_BINANCE_ANNOUNCEMENTS:
        return this.handlePollBinanceAnnouncements(startTime);

      case ExternalDataJobType.POLL_OKX_ANNOUNCEMENTS:
        return this.handlePollOkxAnnouncements(startTime);

      case ExternalDataJobType.POLL_FEAR_GREED:
        return this.handlePollFearGreed(startTime);

      case ExternalDataJobType.RETENTION_CLEANUP:
        return this.handleRetentionCleanup();

      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
        return { status: 'SKIPPED' };
    }
  }

  private async handlePollRssSources(startTime: number) {
    const sources = await this.prisma.externalDataSource.findMany({
      where: { isEnabled: true },
    });

    let totalFetched = 0;
    let totalAccepted = 0;

    for (const source of sources) {
      try {
        const fetchResult = await this.rssAdapter.fetchLatest({
          sourceId: source.sourceId,
          feedUrl: source.feedUrl,
          etag: source.etag || undefined,
          lastModified: source.lastModified || undefined,
        });

        const ingestionResult = await this.newsIngestionService.processRawNewsItems(
          source.sourceId,
          source.sourceType,
          source.reliabilityScore,
          source.isCustom === false && source.reliabilityScore >= 90,
          fetchResult.items,
        );

        totalFetched += ingestionResult.totalFetched;
        totalAccepted += ingestionResult.accepted;

        await this.prisma.externalDataSource.update({
          where: { id: source.id },
          data: {
            etag: fetchResult.etag || source.etag,
            lastModified: fetchResult.lastModified || source.lastModified,
            lastFetchedAt: new Date(),
            lastSuccessAt: new Date(),
            lastError: null,
          },
        });

        await this.providerHealth.recordAttempt(
          source.provider,
          Date.now() - startTime,
          ingestionResult.totalFetched,
          ingestionResult.accepted,
        );
      } catch (err: any) {
        this.logger.error(`Failed RSS poll for source ${source.sourceId}: ${err.message}`);
        await this.prisma.externalDataSource.update({
          where: { id: source.id },
          data: {
            lastFetchedAt: new Date(),
            lastError: err.message,
          },
        });

        await this.providerHealth.recordAttempt(
          source.provider,
          Date.now() - startTime,
          0,
          0,
          { code: err.code, message: err.message },
        );
      }
    }

    return { totalFetched, totalAccepted };
  }

  private async handlePollBinanceAnnouncements(startTime: number) {
    const announcements = await this.binanceAdapter.fetchLatest();
    let accepted = 0;

    for (const item of announcements) {
      try {
        const created = await this.prisma.exchangeAnnouncement.upsert({
          where: { canonicalUrl: item.canonicalUrl },
          create: {
            externalId: item.externalId || null,
            provider: item.provider,
            category: item.category,
            title: item.title,
            summary: item.summary || null,
            canonicalUrl: item.canonicalUrl,
            publishedAt: item.publishedAt,
            relatedSymbols: item.relatedSymbols,
            importanceScore: item.importanceScore,
            sourceReliabilityScore: item.sourceReliabilityScore,
            rawLanguage: item.rawLanguage || 'en',
          },
          update: {
            category: item.category,
            title: item.title,
            summary: item.summary || null,
            relatedSymbols: item.relatedSymbols,
            importanceScore: item.importanceScore,
          },
        });

        accepted++;
        await this.eventPublisher.publishExchangeAnnouncementCreated(created);
      } catch (err: any) {
        this.logger.error(`Error saving Binance announcement "${item.title}": ${err.message}`);
      }
    }

    await this.providerHealth.recordAttempt(
      'BINANCE_ANNOUNCEMENTS',
      Date.now() - startTime,
      announcements.length,
      accepted,
    );

    return { totalFetched: announcements.length, accepted };
  }

  private async handlePollOkxAnnouncements(startTime: number) {
    const announcements = await this.okxAdapter.fetchLatest();
    let accepted = 0;

    for (const item of announcements) {
      try {
        const created = await this.prisma.exchangeAnnouncement.upsert({
          where: { canonicalUrl: item.canonicalUrl },
          create: {
            externalId: item.externalId || null,
            provider: item.provider,
            category: item.category,
            title: item.title,
            summary: item.summary || null,
            canonicalUrl: item.canonicalUrl,
            publishedAt: item.publishedAt,
            relatedSymbols: item.relatedSymbols,
            importanceScore: item.importanceScore,
            sourceReliabilityScore: item.sourceReliabilityScore,
            rawLanguage: item.rawLanguage || 'en',
          },
          update: {
            category: item.category,
            title: item.title,
            summary: item.summary || null,
            relatedSymbols: item.relatedSymbols,
            importanceScore: item.importanceScore,
          },
        });

        accepted++;
        await this.eventPublisher.publishExchangeAnnouncementCreated(created);
      } catch (err: any) {
        this.logger.error(`Error saving OKX announcement "${item.title}": ${err.message}`);
      }
    }

    await this.providerHealth.recordAttempt(
      'OKX_ANNOUNCEMENTS',
      Date.now() - startTime,
      announcements.length,
      accepted,
    );

    return { totalFetched: announcements.length, accepted };
  }

  private async handlePollFearGreed(startTime: number) {
    const observations = await this.fearGreedAdapter.fetchLatest({ limit: 5 });
    let accepted = 0;

    for (const obs of observations) {
      try {
        const created = await this.prisma.marketSentimentObservation.upsert({
          where: {
            provider_indexType_observedAt: {
              provider: obs.provider,
              indexType: obs.indexType as any,
              observedAt: obs.observedAt,
            },
          },
          create: {
            provider: obs.provider,
            indexType: obs.indexType as any,
            value: obs.value,
            classification: obs.classification,
            observedAt: obs.observedAt,
            metadata: obs.metadata ? (obs.metadata as any) : undefined,
          },
          update: {
            value: obs.value,
            classification: obs.classification,
          },
        });

        accepted++;
        await this.eventPublisher.publishSentimentUpdated(created);
      } catch (err: any) {
        this.logger.error(`Error saving Fear & Greed observation: ${err.message}`);
      }
    }

    await this.providerHealth.recordAttempt(
      'ALTERNATIVE_ME_FEAR_GREED',
      Date.now() - startTime,
      observations.length,
      accepted,
    );

    return { totalFetched: observations.length, accepted };
  }

  private async handleRetentionCleanup() {
    this.logger.log('Executing Phase 5 data retention cleanup...');
    const now = new Date();

    // Clean old ingestion runs (> 90 days)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const runsDeleted = await this.prisma.externalDataIngestionRun.deleteMany({
      where: { startedAt: { lt: ninetyDaysAgo } },
    });

    return { status: 'COMPLETED', runsDeleted: runsDeleted.count };
  }
}
