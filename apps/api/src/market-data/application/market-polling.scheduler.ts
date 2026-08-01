import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MarketDataConfigService } from './market-data-config.service';

@Injectable()
export class MarketPollingScheduler implements OnModuleInit {
  private readonly logger = new Logger(MarketPollingScheduler.name);

  constructor(
    @InjectQueue('market-polling') private readonly pollingQueue: Queue,
    private readonly configService: MarketDataConfigService,
  ) {}

  async onModuleInit() {
    if (!this.configService.isEnabled()) {
      return;
    }

    const config = this.configService.getConfig();

    this.logger.log('Registering repeating jobs for market data...');

    // Clear existing repeatable jobs to avoid duplicates on restart
    const jobs = await this.pollingQueue.getRepeatableJobs();
    for (const job of jobs) {
      await this.pollingQueue.removeRepeatableByKey(job.key);
    }

    if (config.funding.enabled) {
      await this.pollingQueue.add(
        'poll-funding-rate',
        {},
        {
          repeat: {
            every: config.funding.pollIntervalSeconds * 1000,
          },
          removeOnComplete: true,
          removeOnFail: false,
          jobId: 'repeat-funding',
        },
      );
    }

    if (config.openInterest.enabled) {
      await this.pollingQueue.add(
        'poll-open-interest',
        {},
        {
          repeat: {
            every: config.openInterest.pollIntervalSeconds * 1000,
          },
          removeOnComplete: true,
          removeOnFail: false,
          jobId: 'repeat-oi',
        },
      );
    }

    // Refresh instruments hourly
    await this.pollingQueue.add(
      'refresh-instruments',
      {},
      {
        repeat: { every: 3600000 },
        removeOnComplete: true,
        removeOnFail: false,
        jobId: 'repeat-instruments',
      },
    );

    // Candle gap scan every 10 minutes
    await this.pollingQueue.add(
      'scan-candle-gaps',
      {},
      {
        repeat: { every: 600000 },
        removeOnComplete: true,
        removeOnFail: false,
        jobId: 'repeat-gap-scan',
      },
    );
  }
}
