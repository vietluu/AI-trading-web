import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ExternalDataProvider, NewsSourceType } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { EXTERNAL_DATA_QUEUE_NAME, ExternalDataJobType } from '../../infrastructure/queues/external-data-queue.constants';

@Injectable()
export class ExternalDataSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExternalDataSchedulerService.name);

  constructor(
    @InjectQueue(EXTERNAL_DATA_QUEUE_NAME) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap() {
    this.logger.log('Initializing External Data Queue schedulers and default seed sources...');
    await this.seedDefaultSources();
    await this.scheduleRepeatableJobs();
  }

  private async seedDefaultSources() {
    const defaultSources = [
      {
        sourceId: 'coindesk-rss',
        displayName: 'CoinDesk Main Feed',
        provider: ExternalDataProvider.GENERIC_RSS,
        sourceType: NewsSourceType.RSS,
        baseDomain: 'coindesk.com',
        feedUrl: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
        language: 'en',
        categories: ['news', 'market'],
        reliabilityScore: 85,
        pollIntervalSeconds: 300,
      },
      {
        sourceId: 'cointelegraph-rss',
        displayName: 'Cointelegraph Feed',
        provider: ExternalDataProvider.GENERIC_RSS,
        sourceType: NewsSourceType.RSS,
        baseDomain: 'cointelegraph.com',
        feedUrl: 'https://cointelegraph.com/rss',
        language: 'en',
        categories: ['news', 'analysis'],
        reliabilityScore: 80,
        pollIntervalSeconds: 300,
      },
      {
        sourceId: 'binance-announcements',
        displayName: 'Binance Official Announcements',
        provider: ExternalDataProvider.BINANCE_ANNOUNCEMENTS,
        sourceType: NewsSourceType.EXCHANGE_ANNOUNCEMENT,
        baseDomain: 'binance.com',
        feedUrl: 'https://www.binance.com/en/support/announcement/rss',
        language: 'en',
        categories: ['announcement', 'exchange'],
        reliabilityScore: 100,
        pollIntervalSeconds: 300,
      },
      {
        sourceId: 'okx-announcements',
        displayName: 'OKX Official Announcements',
        provider: ExternalDataProvider.OKX_ANNOUNCEMENTS,
        sourceType: NewsSourceType.EXCHANGE_ANNOUNCEMENT,
        baseDomain: 'okx.com',
        feedUrl: 'https://www.okx.com/support/hc/en-us/rss',
        language: 'en',
        categories: ['announcement', 'exchange'],
        reliabilityScore: 100,
        pollIntervalSeconds: 300,
      },
    ];

    for (const source of defaultSources) {
      await this.prisma.externalDataSource.upsert({
        where: { sourceId: source.sourceId },
        create: source,
        update: {
          displayName: source.displayName,
          feedUrl: source.feedUrl,
          reliabilityScore: source.reliabilityScore,
        },
      });
    }

    this.logger.log(`Seeded ${defaultSources.length} default external data sources`);
  }

  private async scheduleRepeatableJobs() {
    try {
      // 1. Poll RSS Sources (every 5 minutes)
      await this.queue.add(
        ExternalDataJobType.POLL_RSS_SOURCES,
        {},
        {
          repeat: { every: 300000 },
          jobId: 'repeatable-poll-rss-sources',
        } as any,
      );

      // 2. Poll Binance Announcements (every 5 minutes)
      await this.queue.add(
        ExternalDataJobType.POLL_BINANCE_ANNOUNCEMENTS,
        {},
        {
          repeat: { every: 300000 },
          jobId: 'repeatable-poll-binance-announcements',
        } as any,
      );

      // 3. Poll OKX Announcements (every 5 minutes)
      await this.queue.add(
        ExternalDataJobType.POLL_OKX_ANNOUNCEMENTS,
        {},
        {
          repeat: { every: 300000 },
          jobId: 'repeatable-poll-okx-announcements',
        } as any,
      );

      // 4. Poll Fear & Greed Index (every 1 hour)
      await this.queue.add(
        ExternalDataJobType.POLL_FEAR_GREED,
        {},
        {
          repeat: { every: 3600000 },
          jobId: 'repeatable-poll-fear-greed',
        } as any,
      );

      // 5. Retention Cleanup (every 24 hours)
      await this.queue.add(
        ExternalDataJobType.RETENTION_CLEANUP,
        {},
        {
          repeat: { every: 86400000 },
          jobId: 'repeatable-retention-cleanup',
        } as any,
      );

      this.logger.log('Successfully registered repeatable BullMQ ingestion schedules');
    } catch (err: any) {
      this.logger.error(`Failed to register BullMQ repeatable jobs: ${err.message}`);
    }
  }

  async triggerManualRun(provider: string, sourceId?: string) {
    const jobId = `manual-trigger-${provider}-${Date.now()}`;
    if (provider === ExternalDataProvider.GENERIC_RSS) {
      await this.queue.add(ExternalDataJobType.POLL_RSS_SOURCES, { sourceId }, { jobId });
    } else if (provider === ExternalDataProvider.BINANCE_ANNOUNCEMENTS) {
      await this.queue.add(ExternalDataJobType.POLL_BINANCE_ANNOUNCEMENTS, {}, { jobId });
    } else if (provider === ExternalDataProvider.OKX_ANNOUNCEMENTS) {
      await this.queue.add(ExternalDataJobType.POLL_OKX_ANNOUNCEMENTS, {}, { jobId });
    } else if (provider === ExternalDataProvider.ALTERNATIVE_ME_FEAR_GREED) {
      await this.queue.add(ExternalDataJobType.POLL_FEAR_GREED, {}, { jobId });
    }
    return { jobId, status: 'QUEUED' };
  }
}
