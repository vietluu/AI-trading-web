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
    if (process.env.CLI_DISABLE_SCHEDULERS === 'true') return;
    if (!this.configService.isEnabled()) {
      return;
    }

    const config = this.configService.getConfig();

    this.logger.log('Registering repeating jobs for market data...');

    // In BullMQ v6, we use upsertJobScheduler for repeatable jobs
    if (config.funding.enabled) {
      await this.pollingQueue.upsertJobScheduler(
        'repeat-funding',
        { every: config.funding.pollIntervalSeconds * 1000 },
        {
          name: 'poll-funding-rate',
          data: {},
          opts: { removeOnComplete: true, removeOnFail: false },
        }
      );
    }

    if (config.openInterest.enabled) {
      await this.pollingQueue.upsertJobScheduler(
        'repeat-oi',
        { every: config.openInterest.pollIntervalSeconds * 1000 },
        {
          name: 'poll-open-interest',
          data: {},
          opts: { removeOnComplete: true, removeOnFail: false },
        }
      );
    }

    // Refresh instruments hourly
    await this.pollingQueue.upsertJobScheduler(
      'repeat-instruments',
      { every: 3600000 },
      {
        name: 'refresh-instruments',
        data: {},
        opts: { removeOnComplete: true, removeOnFail: false },
      }
    );

    // Candle gap scan every 10 minutes
    await this.pollingQueue.upsertJobScheduler(
      'repeat-gap-scan',
      { every: 600000 },
      {
        name: 'scan-candle-gaps',
        data: {},
        opts: { removeOnComplete: true, removeOnFail: false },
      }
    );
  }
}
