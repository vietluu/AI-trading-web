import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { MarketDataConfigService } from './market-data-config.service';
import { MarketEventBus } from '../infrastructure/event-bus/market-event-bus';
import { BinancePublicStreamAdapter } from '../infrastructure/streams/binance-public-stream.adapter';
import { OkxPublicStreamAdapter } from '../infrastructure/streams/okx-public-stream.adapter';
import { ExchangeProvider } from '../../exchange/domain/exchange.types';
import type { PublicMarketStreamAdapter } from '../domain/public-market-stream.adapter';
import { MarketEventType } from '../domain/market-data.enums';

@Injectable()
export class MarketStreamManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketStreamManager.name);
  private readonly adapters = new Map<ExchangeProvider, PublicMarketStreamAdapter>();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly configService: MarketDataConfigService,
    private readonly eventBus: MarketEventBus,
    private readonly binanceAdapter: BinancePublicStreamAdapter,
    private readonly okxAdapter: OkxPublicStreamAdapter,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.configService.isEnabled()) {
      return;
    }

    const config = this.configService.getConfig();

    if (config.providers.includes(ExchangeProvider.BINANCE_FUTURES)) {
      this.adapters.set(ExchangeProvider.BINANCE_FUTURES, this.binanceAdapter);
    }
    if (config.providers.includes(ExchangeProvider.OKX_FUTURES)) {
      this.adapters.set(ExchangeProvider.OKX_FUTURES, this.okxAdapter);
    }

    // Connect and subscribe for each adapter
    for (const [provider, adapter] of this.adapters.entries()) {
      try {
        // Forward events to event bus
        this.unsubscribers.push(
          adapter.onEvent((event) => {
            this.eventBus.emit(event);
          })
        );

        // Forward status changes (optional, could be mapped to events)
        this.unsubscribers.push(
          adapter.onStatusChange((status) => {
            this.logger.debug({ event: 'stream_status_changed', provider, status: status.state });
          })
        );

        this.unsubscribers.push(
          adapter.onError((error) => {
            this.logger.error({ event: 'stream_error', provider, error: error.message });
            this.eventBus.emit({
              type: MarketEventType.STREAM_DISCONNECTED,
              metadata: {
                eventId: crypto.randomUUID(),
                provider,
                symbol: '',
                exchangeTimestamp: error.timestamp,
                receivedAt: new Date(),
                sourceChannel: 'error',
                schemaVersion: 1,
              },
              payload: { provider, reason: error.message }
            });
          })
        );

        await adapter.connect();
        
        // Initial subscriptions
        if (config.symbols.length > 0) {
          if (config.ticker.enabled) {
            await adapter.subscribeTicker(config.symbols);
          }
          if (config.trades.enabled) {
            await adapter.subscribeTrades(config.symbols);
          }
          if (config.candles.enabled && config.intervals.length > 0) {
            const candleSubs = config.symbols.flatMap((symbol) =>
              config.intervals.map((interval) => ({ symbol, interval }))
            );
            await adapter.subscribeCandles(candleSubs);
          }
          if (config.orderBook.enabled) {
            const obSubs = config.symbols.map((symbol) => ({
              symbol,
              depth: config.orderBook.depth,
            }));
            await adapter.subscribeOrderBook(obSubs);
          }
        }
      } catch (error) {
        this.logger.error({
          event: 'adapter_init_error',
          provider,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;

    for (const adapter of this.adapters.values()) {
      await adapter.disconnect().catch((err) => {
        this.logger.error({
          event: 'adapter_disconnect_error',
          provider: adapter.provider,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    this.adapters.clear();
  }
}
