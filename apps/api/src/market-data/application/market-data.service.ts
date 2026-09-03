import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  ExchangeInterval,
  type ExchangeProvider,
} from "../../exchange/domain/exchange.types";
import { MarketEventType, IndicatorStatus } from "../domain/market-data.enums";
import type {
  NormalizedMarketEvent,
  MarketEventMetadata,
  NormalizedCandle,
  NormalizedTicker,
  NormalizedFundingRate,
  NormalizedOpenInterest,
  NormalizedOrderBook,
  IndicatorSnapshot,
} from "../domain/market-data.types";
import {
  calculateAllIndicators,
  CALCULATION_VERSION,
} from "../domain/indicators/indicator-calculator";
import { MarketEventBus } from "../infrastructure/event-bus/market-event-bus";
import { MarketRedisCacheService } from "../infrastructure/redis/market-redis-cache.service";
import { MarketDataRepository } from "../infrastructure/persistence/market-data.repository";
import { MarketDataConfigService } from "./market-data-config.service";
import { PublicExchangeService } from "../../exchange/application/public-exchange.service";

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
    private readonly exchanges: PublicExchangeService,
  ) {}

  async getHistoricalCandles(query: {
    provider: ExchangeProvider;
    symbol: string;
    interval: ExchangeInterval;
    startTime?: Date;
    endTime?: Date;
    limit: number;
  }): Promise<NormalizedCandle[]> {
    const stored = await this.repository.getCandles(query);
    if (
      stored.length >= query.limit &&
      this.hasFreshClosedCandle(stored, query.interval)
    ) return stored;

    let candles: NormalizedCandle[] = [];
    try {
      candles = await this.exchanges.klines(query.provider, {
        symbol: query.symbol,
        interval: query.interval,
        limit: Math.max(query.limit, 2),
        ...(query.startTime ? { startTime: query.startTime } : {}),
        ...(query.endTime ? { endTime: query.endTime } : {}),
      });
    } catch (error) {
      this.logger.warn({
        event: "market_data_fetch_failed",
        provider: query.provider,
        symbol: query.symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      // Preserve the stale observation for diagnostics. The pipeline freshness
      // gate will reject it; callers must never mistake an empty array for a
      // healthy market with no movement.
      return stored;
    }

    if (candles.length > 0) {
      await this.repository.upsertCandleBatch(candles);
      const lastClosed = [...candles]
        .reverse()
        .find((candle) => candle.isClosed);
      if (lastClosed) {
        await this.calculateAndPersistIndicators(
          query.provider,
          query.symbol,
          query.interval,
          lastClosed,
        );
      }
    }
    return query.limit > 0 ? candles.slice(-query.limit) : candles;
  }

  async getIndicatorSnapshot(
    provider: ExchangeProvider,
    symbol: string,
    interval: ExchangeInterval,
  ): Promise<IndicatorSnapshot | null> {
    const cached = await this.cache.getIndicator(provider, symbol, interval);
    if (cached && this.isFreshTimestamp(cached.candleCloseTime, interval)) {
      return cached;
    }

    const persisted = await this.repository.getLatestIndicatorSnapshot(
      provider,
      symbol,
      interval,
    );
    if (persisted && this.isFreshTimestamp(persisted.candleCloseTime, interval)) {
      await this.cache.setIndicator(provider, symbol, interval, persisted);
      return persisted;
    }

    const candles = await this.getHistoricalCandles({
      provider,
      symbol,
      interval,
      limit: 250,
    });
    const calculated = await this.cache.getIndicator(provider, symbol, interval);
    if (calculated) return calculated;

    // getHistoricalCandles returns early when PostgreSQL already contains the
    // requested amount. In that path no indicator calculation is triggered,
    // so explicitly rebuild the expired cache from the latest closed candle.
    const lastClosed = [...candles].reverse().find((candle) => candle.isClosed);
    if (lastClosed) {
      await this.calculateAndPersistIndicators(
        provider,
        symbol,
        interval,
        lastClosed,
      );
    }
    return this.cache.getIndicator(provider, symbol, interval);
  }

  private hasFreshClosedCandle(
    candles: NormalizedCandle[],
    interval: ExchangeInterval,
  ): boolean {
    const latestClosed = candles
      .filter((candle) => candle.isClosed)
      .reduce<NormalizedCandle | undefined>(
        (latest, candle) =>
          !latest || candle.closeTime > latest.closeTime ? candle : latest,
        undefined,
      );
    return Boolean(
      latestClosed && this.isFreshTimestamp(latestClosed.closeTime, interval),
    );
  }

  private isFreshTimestamp(
    timestamp: Date | string | number | undefined | null,
    interval: ExchangeInterval,
  ): boolean {
    if (!timestamp) return false;
    const timeMs =
      timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
    if (!Number.isFinite(timeMs)) return false;
    const ageMs = Date.now() - timeMs;
    return ageMs >= -60_000 && ageMs <= this.intervalMilliseconds(interval) * 2;
  }

  private intervalMilliseconds(interval: ExchangeInterval): number {
    const match = /^(\d+)([mhdwM])$/.exec(interval);
    if (!match) return 15 * 60_000;
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit === 'm') return amount * 60_000;
    if (unit === 'h') return amount * 3_600_000;
    if (unit === 'd') return amount * 86_400_000;
    if (unit === 'w') return amount * 7 * 86_400_000;
    return amount * 30 * 86_400_000;
  }

  onModuleInit(): void {
    if (process.env.CLI_DISABLE_SCHEDULERS === 'true') return;
    if (!this.configService.isEnabled()) {
      this.logger.log({ event: "market_data_disabled" });
      return;
    }

    // Listen to events on the bus
    this.unsubscribers.push(
      this.eventBus.on("market.*", (event) => {
        void this.handleEvent(event);
      }),
    );

    // Start persistence flush timer
    const { flushIntervalMs } = this.configService.getConfig().persistence;
    this.flushTimer = setInterval(() => {
      void this.flushCandleBuffer();
    }, flushIntervalMs);

    this.logger.log({ event: "market_data_service_started" });
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
    this.logger.log({ event: "market_data_service_stopped" });
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
        event: "event_handling_error",
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
    await this.cache.setCandle(
      candle.provider,
      candle.symbol,
      candle.interval,
      candle,
    );
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

    await this.cache.setCandle(
      candle.provider,
      candle.symbol,
      candle.interval,
      candle,
    );

    // Calculate indicators on candle close
    await this.calculateAndPersistIndicators(
      candle.provider,
      candle.symbol,
      candle.interval,
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
        timestamp: oi.timestamp,
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
          event: "candle_flush_error",
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
      await this.repository.upsertIndicatorSnapshot(snapshot);

      this.logger.debug({
        event: "indicators_calculated",
        provider,
        symbol,
        interval,
        indicatorCount: Object.keys(values).length,
      });
    } catch (error) {
      this.logger.error({
        event: "indicator_calculation_error",
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
