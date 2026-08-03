import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { MarketDataConfigService } from '../../application/market-data-config.service';
import { MarketBackfillService } from '../../application/market-backfill.service';
import { PublicExchangeService } from '../../../exchange/application/public-exchange.service';
import { MarketEventBus } from '../event-bus/market-event-bus';
import { MarketEventType } from '../../domain/market-data.enums';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

@Processor('market-polling', {
  limiter: {
    max: 10,
    duration: 1000,
  }
})
export class MarketPollingProcessor extends WorkerHost {
  private readonly logger = new Logger(MarketPollingProcessor.name);

  constructor(
    private readonly configService: MarketDataConfigService,
    private readonly backfillService: MarketBackfillService,
    private readonly exchangeService: PublicExchangeService,
    private readonly eventBus: MarketEventBus,
  ) {
    super();
  }

  process(job: Job<unknown, unknown, string>): Promise<unknown> {
    this.logger.debug(`Processing polling job: ${job.name}`);
    
    switch (job.name) {
      case 'poll-funding-rate':
        return this.pollFundingRates();
      case 'poll-open-interest':
        return this.pollOpenInterest();
      case 'refresh-instruments':
        return this.refreshInstruments();
      case 'scan-candle-gaps':
        return this.backfillService.detectGaps();
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
        return Promise.resolve(undefined);
    }
  }

  private async pollFundingRates(): Promise<{ success: boolean; timestamp: Date }> {
    this.logger.log('Polling funding rates...');
    const config = this.configService.getConfig();
    let hasError = false;

    for (const provider of config.providers) {
      for (const symbol of config.symbols) {
        try {
          const funding = await this.exchangeService.funding(provider, symbol);
          this.eventBus.emit({
            type: MarketEventType.FUNDING_RATE_UPDATED,
            metadata: {
              eventId: crypto.randomUUID(),
              provider,
              symbol,
              exchangeTimestamp: funding.fundingTime,
              receivedAt: new Date(),
              sourceChannel: 'polling',
              schemaVersion: 1,
            },
            payload: {
              provider,
              symbol,
              fundingRate: funding.fundingRate,
              fundingTime: funding.fundingTime,
              nextFundingTime: funding.nextFundingTime,
              markPrice: funding.markPrice,
            }
          });
          
          await delay(100);
        } catch (error) {
          this.logger.error(`Failed to poll funding rate for ${provider} ${symbol}`, error);
          hasError = true;
        }
      }
    }
    
    return { success: !hasError, timestamp: new Date() };
  }

  private async pollOpenInterest(): Promise<{ success: boolean; timestamp: Date }> {
    this.logger.log('Polling open interest...');
    const config = this.configService.getConfig();
    let hasError = false;

    for (const provider of config.providers) {
      for (const symbol of config.symbols) {
        try {
          const oi = await this.exchangeService.openInterest(provider, symbol);
          this.eventBus.emit({
            type: MarketEventType.OPEN_INTEREST_UPDATED,
            metadata: {
              eventId: crypto.randomUUID(),
              provider,
              symbol,
              exchangeTimestamp: oi.timestamp,
              receivedAt: new Date(),
              sourceChannel: 'polling',
              schemaVersion: 1,
            },
            payload: {
              provider,
              symbol,
              openInterest: oi.openInterest,
              openInterestValue: oi.openInterestValue,
              timestamp: oi.timestamp,
            }
          });
          
          await delay(100);
        } catch (error) {
          this.logger.error(`Failed to poll open interest for ${provider} ${symbol}`, error);
          hasError = true;
        }
      }
    }

    return { success: !hasError, timestamp: new Date() };
  }

  private async refreshInstruments(): Promise<{ success: boolean; timestamp: Date }> {
    this.logger.log('Refreshing market instruments metadata...');
    const config = this.configService.getConfig();
    let hasError = false;

    for (const provider of config.providers) {
      try {
        const instruments = await this.exchangeService.instruments(provider);
        this.logger.log(`Refreshed ${instruments.length} instruments for ${provider}`);
        await delay(200);
      } catch (error) {
        this.logger.error(`Failed to refresh instruments for ${provider}`, error);
        hasError = true;
      }
    }
    
    return { success: !hasError, timestamp: new Date() };
  }
}
