import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ExchangeInterval,
  type ExchangeProvider,
} from '../../exchange/domain/exchange.types';
import { MarketEventType, IndicatorStatus } from '../domain/market-data.enums';
import type {
  NormalizedMarketEvent,
  MarketEventMetadata,
  NormalizedCandle,
  NormalizedTicker,
  NormalizedFundingRate,
  NormalizedOpenInterest,
  NormalizedOrderBook,
  IndicatorSnapshot,
} from '../domain/market-data.types';
import {
  calculateAllIndicators,
  CALCULATION_VERSION,
} from '../domain/indicators/indicator-calculator';
import { MarketEventBus } from '../infrastructure/event-bus/market-event-bus';
import { MarketRedisCacheService } from '../infrastructure/redis/market-redis-cache.service';
import { MarketDataRepository } from '../infrastructure/persistence/market-data.repository';
import { MarketDataConfigService } from './market-data-config.service';

@Injectable()
export class MarketDataService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketDataService.name);
  private readonly unsubscribers: Array<() => void> = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private readonly candleBuffer: Map<string, NormalizedCandle> = new Map();

  constructor(
    private readonly configService: MarketDataConfigService,
    private readonly eventBus: MarketEventBus,
    private readonly cache: MarketRedisCacheService,
    private readonly repository: MarketDataRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.configService.isEnabled()) {
      this.logger.log({ event: 'market_data_disabled' });
      return;
    }

    // Listen to events on the bus
    this.unsubscribers.push(
      this.eventBus.on('market.*', (event) => {
        void this.handleEvent(event);
      }),
    );

    // Start persistence flush timer
    const { flushIntervalMs } = this.configService.getConfig().persistence;
    this.flushTimer = setInterval(() => {
      void this.flushCandleBuffer();
    }, flushIntervalMs);

    this.logger.log({ event: 'market_data_service_started' });
  }

  async onModuleDestroy(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flushCandleBuffer();
    this.logger.log({ event: 'market_data_service_stopped' });
  }

  private async handleEvent(event: NormalizedMarketEvent): Promise<void> {
    try {
      switch (event.type) {
        case MarketEventType.TICKER_UPDATED:
          await this.handleTicker(event.payload);
          break;
        case MarketEventType.CANDLE_UPDATED:
          await this.handleCandleUpdate(event.payload);
          break;
        case MarketEventType.CANDLE_CLOSED:
          await this.handleCandleClose(event.payload);
          break;
        case MarketEventType.ORDER_BOOK_UPDATED:
          await this.handleOrderBook(event.payload);
          break;
        case MarketEventType.FUNDING_RATE_UPDATED:
          await this.handleFunding(event.payload);
          break;
        case MarketEventType.OPEN_INTEREST_UPDATED:
          await this.handleOpenInterest(event.payload);
          break;
        default:
          break;
      }
    } catch (error) {
      this.logger.error({
        event: 'event_handling_error',
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleTicker(ticker: NormalizedTicker): Promise<void> {
    await this.cache.setTicker(ticker.provider, ticker.symbol, ticker);
  }

  private async handleCandleUpdate(candle: NormalizedCandle): Promise<void> {
    const key = `${candle.provider}:${candle.symbol}:${candle.interval}:${candle.openTime.getTime()}`;
    this.candleBuffer.set(key, candle);
    await this.cache.setCandle(candle.provider, candle.symbol, candle.interval, candle);
  }

  private async handleCandleClose(candle: NormalizedCandle): Promise<void> {
    const key = `${candle.provider}:${candle.symbol}:${candle.interval}:${candle.openTime.getTime()}`;
    this.candleBuffer.delete(key);

    await this.repository.upsertCandle({
      provider: candle.provider,
      symbol: candle.symbol,
      interval: candle.interval,
      openTime: candle.openTime,
      closeTime: candle.closeTime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      quoteVolume: candle.quoteVolume,
      tradeCount: candle.tradeCount,
      isClosed: true,
    });

    await this.cache.setCandle(candle.provider, candle.symbol, candle.interval, candle);

    // Calculate indicators on candle close
    await this.calculateAndPersistIndicators(
      candle.provider,
      candle.symbol,
      candle.interval as ExchangeInterval,
      candle,
    );
  }

  private async handleOrderBook(book: NormalizedOrderBook): Promise<void> {
    await this.cache.setOrderBook(book.provider, book.symbol, book.depth, book);
  }

  private async handleFunding(funding: NormalizedFundingRate): Promise<void> {
    await this.cache.setFunding(funding.provider, funding.symbol, funding);
    await this.repository.upsertFundingRate({
      provider: funding.provider,
      symbol: funding.symbol,
      fundingRate: funding.fundingRate,
      fundingTime: funding.fundingTime,
      nextFundingTime: funding.nextFundingTime,
      markPrice: funding.markPrice,
    });
  }

  private async handleOpenInterest(oi: NormalizedOpenInterest): Promise<void> {
    await this.cache.setOpenInterest(oi.provider, oi.symbol, oi);
    await this.repository.upsertOpenInterest({
      provider: oi.provider,
      symbol: oi.symbol,
      openInterest: oi.openInterest,
      openInterestValue: oi.openInterestValue,
      recordedAt: oi.timestamp,
    });
  }

  private async flushCandleBuffer(): Promise<void> {
    if (this.candleBuffer.size === 0) return;

    const candles = Array.from(this.candleBuffer.values());
    const { batchSize } = this.configService.getConfig().persistence;

    for (let i = 0; i < candles.length; i += batchSize) {
      const batch = candles.slice(i, i + batchSize);
      try {
        await this.repository.upsertCandleBatch(
          batch.map((c) => ({
            provider: c.provider,
            symbol: c.symbol,
            interval: c.interval,
            openTime: c.openTime,
            closeTime: c.closeTime,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            quoteVolume: c.quoteVolume,
            tradeCount: c.tradeCount,
            isClosed: c.isClosed,
          })),
        );
      } catch (error) {
        this.logger.error({
          event: 'candle_flush_error',
          batchSize: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async calculateAndPersistIndicators(
    provider: ExchangeProvider,
    symbol: string,
    interval: ExchangeInterval,
    closedCandle: NormalizedCandle,
  ): Promise<void> {
    try {
      const historicalCandles = await this.repository.getClosedCandles({
        provider,
        symbol,
        interval,
        limit: 250,
      });

      if (historicalCandles.length === 0) return;

      const candleData = historicalCandles.map((c) => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

      const values = calculateAllIndicators(candleData);
      const hasValues = Object.keys(values).length > 0;
      if (!hasValues) return;

      const snapshot: IndicatorSnapshot = {
        provider,
        symbol,
        interval,
        candleOpenTime: closedCandle.openTime,
        candleCloseTime: closedCandle.closeTime,
        status: IndicatorStatus.CLOSED,
        values,
        calculatedAt: new Date(),
        calculationVersion: CALCULATION_VERSION,
      };

      await this.cache.setIndicator(provider, symbol, interval, snapshot);
      await this.repository.upsertIndicatorSnapshot({
        provider,
        symbol,
        interval,
        candleOpenTime: closedCandle.openTime,
        candleCloseTime: closedCandle.closeTime,
        status: 'CLOSED',
        values: values as unknown as Record<string, unknown>,
        calculationVersion: CALCULATION_VERSION,
      });

      this.logger.debug({
        event: 'indicators_calculated',
        provider,
        symbol,
        interval,
        indicatorCount: Object.keys(values).length,
      });
    } catch (error) {
      this.logger.error({
        event: 'indicator_calculation_error',
        provider,
        symbol,
        interval,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Public API helpers
  createMetadata(
    provider: ExchangeProvider,
    symbol: string,
    exchangeTimestamp: Date,
    sourceChannel: string,
  ): MarketEventMetadata {
    return {
      eventId: randomUUID(),
      provider,
      symbol,
      exchangeTimestamp,
      receivedAt: new Date(),
      sourceChannel,
      schemaVersion: 1,
    };
  }
}
