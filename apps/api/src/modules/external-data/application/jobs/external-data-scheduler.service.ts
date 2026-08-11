import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
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
    if (process.env.CLI_DISABLE_SCHEDULERS === 'true') return;
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
        isEnabled: true,
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
        isEnabled: true,
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
        isEnabled: false,
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
        isEnabled: false,
      },
    ];

    for (const source of defaultSources) {
      await this.prisma.externalDataSource.upsert({
        where: { sourceId: source.sourceId },
        create: source,
        update: {
          displayName: source.displayName,
          provider: source.provider,
          sourceType: source.sourceType,
          baseDomain: source.baseDomain,
          feedUrl: source.feedUrl,
          language: source.language,
          categories: source.categories,
          reliabilityScore: source.reliabilityScore,
          pollIntervalSeconds: source.pollIntervalSeconds,
        },
      });
    }

    this.logger.log(`Seeded ${defaultSources.length} default external data sources`);
  }

  private async scheduleRepeatableJobs() {
    try {
      await Promise.all([
        this.upsertScheduler(
          'repeatable-poll-rss-sources',
          ExternalDataJobType.POLL_RSS_SOURCES,
          300_000,
        ),
        this.upsertScheduler(
          'repeatable-poll-binance-announcements',
          ExternalDataJobType.POLL_BINANCE_ANNOUNCEMENTS,
          300_000,
        ),
        this.upsertScheduler(
          'repeatable-poll-okx-announcements',
          ExternalDataJobType.POLL_OKX_ANNOUNCEMENTS,
          300_000,
        ),
        this.upsertScheduler(
          'repeatable-poll-fear-greed',
          ExternalDataJobType.POLL_FEAR_GREED,
          3_600_000,
        ),
        this.upsertScheduler(
          'repeatable-retention-cleanup',
          ExternalDataJobType.RETENTION_CLEANUP,
          86_400_000,
        ),
      ]);

      // Do not wait for the first repeat interval after a restart. Stable
      // time-bucket IDs prevent duplicate catch-up jobs across API replicas.
      const fiveMinuteBucket = Math.floor(Date.now() / 300_000);
      const hourlyBucket = Math.floor(Date.now() / 3_600_000);
      await Promise.all([
        this.queue.add(
          ExternalDataJobType.POLL_RSS_SOURCES,
          {},
          { jobId: `startup-rss-${fiveMinuteBucket}`, removeOnComplete: true },
        ),
        this.queue.add(
          ExternalDataJobType.POLL_FEAR_GREED,
          {},
          { jobId: `startup-fear-greed-${hourlyBucket}`, removeOnComplete: true },
        ),
      ]);

      this.logger.log('Successfully registered repeatable BullMQ ingestion schedules');
    } catch (err: any) {
      this.logger.error(`Failed to register BullMQ repeatable jobs: ${err.message}`);
    }
  }

  private upsertScheduler(id: string, name: ExternalDataJobType, every: number) {
    return this.queue.upsertJobScheduler(
      id,
      { every },
      {
        name,
        data: {},
        opts: { removeOnComplete: true, removeOnFail: false },
      },
    );
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
