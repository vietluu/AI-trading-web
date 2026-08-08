import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { MarketDataConfigService } from './market-data-config.service';
import { MarketEventBus } from '../infrastructure/event-bus/market-event-bus';
import { BinancePublicStreamAdapter } from '../infrastructure/streams/binance-public-stream.adapter';
import { OkxPublicStreamAdapter } from '../infrastructure/streams/okx-public-stream.adapter';
import { ExchangeProvider } from '../../exchange/domain/exchange.types';
import type { PublicMarketStreamAdapter } from '../domain/public-market-stream.adapter';
import { MarketEventType } from '../domain/market-data.enums';
import { MarketRedisCacheService } from '../infrastructure/redis/market-redis-cache.service';
import { DistributedTaskLockService } from '../../redis/distributed-task-lock.service';

class MarketStreamLeadershipLostError extends Error {}

@Injectable()
export class MarketStreamManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketStreamManager.name);
  private readonly adapters = new Map<ExchangeProvider, PublicMarketStreamAdapter>();
  private readonly unsubscribers: Array<() => void> = [];
  private statusRefreshTimer: ReturnType<typeof setInterval> | undefined;
  private leadershipTimer: ReturnType<typeof setInterval> | undefined;
  private leaderToken: string | undefined;
  private leadershipCheckRunning = false;
  private streamActive = false;
  private readonly leaseSeconds: number;
  private readonly leadershipCheckMs: number;

  constructor(
    private readonly marketConfig: MarketDataConfigService,
    private readonly eventBus: MarketEventBus,
    private readonly binanceAdapter: BinancePublicStreamAdapter,
    private readonly okxAdapter: OkxPublicStreamAdapter,
    private readonly cache: MarketRedisCacheService,
    private readonly taskLock: DistributedTaskLockService,
    config: ConfigService,
  ) {
    this.leaseSeconds = config.get<number>('MARKET_STREAM_LEADER_LEASE_SECONDS', 30);
    this.leadershipCheckMs = Math.max(1_000, Math.floor(this.leaseSeconds * 1_000 / 3));
  }

  async onModuleInit(): Promise<void> {
    if (!this.marketConfig.isEnabled()) return;

    await this.maintainLeadership();
    this.leadershipTimer = setInterval(() => void this.maintainLeadership(), this.leadershipCheckMs);
    this.leadershipTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.leadershipTimer) clearInterval(this.leadershipTimer);
    const token = this.leaderToken;
    this.leaderToken = undefined;
    await this.stopStreaming();
    if (token) await this.taskLock.release('market-stream-leader', token).catch(() => false);
  }

  private async maintainLeadership(): Promise<void> {
    if (this.leadershipCheckRunning) return;
    this.leadershipCheckRunning = true;
    try {
      if (this.leaderToken) {
        const renewed = await this.taskLock.renew('market-stream-leader', this.leaderToken, this.leaseSeconds);
        if (renewed) return;

        this.logger.warn({ event: 'market_stream_leadership_lost' });
        this.leaderToken = undefined;
        await this.stopStreaming();
        return;
      }

      const token = await this.taskLock.acquire('market-stream-leader', this.leaseSeconds);
      if (!token) return;

      this.leaderToken = token;
      this.logger.log({ event: 'market_stream_leadership_acquired', leaseSeconds: this.leaseSeconds });
      try {
        await this.startStreaming();
      } catch (error) {
        this.logger.error({
          event: 'market_stream_leader_start_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        this.leaderToken = undefined;
        await this.stopStreaming();
        await this.taskLock.release('market-stream-leader', token).catch(() => false);
      }
    } catch (error) {
      // Fail closed: a replica that cannot prove lease ownership must stop
      // exchange streams before another replica is allowed to take over.
      this.logger.error({
        event: 'market_stream_leadership_check_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      this.leaderToken = undefined;
      await this.stopStreaming();
    } finally {
      this.leadershipCheckRunning = false;
    }
  }

  private async startStreaming(): Promise<void> {
    if (this.streamActive) return;
    this.streamActive = true;

    const config = this.marketConfig.getConfig();

    if (config.providers.includes(ExchangeProvider.BINANCE_FUTURES)) {
      this.adapters.set(ExchangeProvider.BINANCE_FUTURES, this.binanceAdapter);
    }
    if (config.providers.includes(ExchangeProvider.OKX_FUTURES)) {
      this.adapters.set(ExchangeProvider.OKX_FUTURES, this.okxAdapter);
    }

    // Connect and subscribe for each adapter
    for (const [provider, adapter] of this.adapters.entries()) {
      try {
        await this.ensureLeaseOwnership();
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
            void this.cache.setStreamStatus(provider, status);
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
        await this.ensureLeaseOwnership();
        await this.cache.setStreamStatus(provider, adapter.getStatus());
      } catch (error) {
        if (error instanceof MarketStreamLeadershipLostError) throw error;
        this.logger.error({
          event: 'adapter_init_error',
          provider,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.statusRefreshTimer = setInterval(() => {
      for (const [provider, adapter] of this.adapters) {
        void this.cache.setStreamStatus(provider, adapter.getStatus());
      }
    }, 15_000);
    this.statusRefreshTimer.unref();
  }

  private async ensureLeaseOwnership(): Promise<void> {
    if (!this.leaderToken || !await this.taskLock.renew(
      'market-stream-leader',
      this.leaderToken,
      this.leaseSeconds,
    )) {
      throw new MarketStreamLeadershipLostError('Market stream leader lease expired during startup');
    }
  }

  private async stopStreaming(): Promise<void> {
    if (!this.streamActive && this.adapters.size === 0 && this.unsubscribers.length === 0) return;
    this.streamActive = false;
    if (this.statusRefreshTimer) {
      clearInterval(this.statusRefreshTimer);
      this.statusRefreshTimer = undefined;
    }
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
