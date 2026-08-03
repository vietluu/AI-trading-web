import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExchangeInterval,
  ExchangeProvider,
} from '../../exchange/domain/exchange.types';
import type { MarketDataConfig } from '../domain/market-data.types';

const VALID_PROVIDERS = new Set(Object.values(ExchangeProvider));
const VALID_INTERVALS = new Set(Object.values(ExchangeInterval));
const SYMBOL_PATTERN = /^[A-Z0-9]{2,15}-[A-Z0-9]{2,15}$/;

function readList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return fallback;
}

function isValidProvider(value: string): value is ExchangeProvider {
  return VALID_PROVIDERS.has(value as ExchangeProvider);
}

function isValidInterval(value: string): value is ExchangeInterval {
  return VALID_INTERVALS.has(value as ExchangeInterval);
}

@Injectable()
export class MarketDataConfigService {
  private readonly logger = new Logger(MarketDataConfigService.name);
  private readonly config: MarketDataConfig;

  constructor(configService: ConfigService) {
    const enabled = configService.get<boolean>('MARKET_DATA_ENABLED') ?? true;
    const rawProviders = readList(
      configService.get<unknown>('MARKET_DATA_PROVIDERS'),
      ['BINANCE_FUTURES', 'OKX_FUTURES'],
    );
    const rawSymbols = readList(
      configService.get<unknown>('MARKET_DATA_SYMBOLS'),
      ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT', 'XRP-USDT', 'DOGE-USDT', 'ADA-USDT', 'AVAX-USDT', 'LINK-USDT', 'NEAR-USDT', 'SUI-USDT'],
    );
    const rawIntervals = readList(
      configService.get<unknown>('MARKET_DATA_INTERVALS'),
      ['1m', '5m', '15m', '1h', '4h'],
    );

    const providers = rawProviders.filter(isValidProvider);

    const symbols = rawSymbols.filter((s) => SYMBOL_PATTERN.test(s));

    const intervals = rawIntervals.filter(isValidInterval);

    // Log rejections
    for (const p of rawProviders) {
      if (!isValidProvider(p)) {
        this.logger.warn({ event: 'unsupported_provider', provider: p });
      }
    }
    for (const s of rawSymbols) {
      if (!SYMBOL_PATTERN.test(s)) {
        this.logger.warn({ event: 'invalid_symbol', symbol: s });
      }
    }
    for (const i of rawIntervals) {
      if (!isValidInterval(i)) {
        this.logger.warn({ event: 'unsupported_interval', interval: i });
      }
    }

    if (enabled && providers.length === 0) {
      this.logger.error({ event: 'no_valid_providers' });
    }
    if (enabled && symbols.length === 0) {
      this.logger.error({ event: 'no_valid_symbols' });
    }
    if (enabled && intervals.length === 0) {
      this.logger.error({ event: 'no_valid_intervals' });
    }

    this.config = {
      enabled,
      providers,
      symbols,
      intervals,
      ticker: { enabled: configService.get<boolean>('MARKET_TICKER_ENABLED') ?? true },
      trades: { enabled: configService.get<boolean>('MARKET_TRADES_ENABLED') ?? true },
      candles: { enabled: configService.get<boolean>('MARKET_CANDLES_ENABLED') ?? true },
      orderBook: {
        enabled: configService.get<boolean>('MARKET_ORDER_BOOK_ENABLED') ?? true,
        depth: configService.get<number>('MARKET_ORDER_BOOK_DEPTH') ?? 20,
        snapshotIntervalSeconds: configService.get<number>('MARKET_ORDER_BOOK_SNAPSHOT_INTERVAL_SECONDS') ?? 10,
      },
      funding: {
        enabled: configService.get<boolean>('MARKET_FUNDING_ENABLED') ?? true,
        pollIntervalSeconds: configService.get<number>('MARKET_FUNDING_POLL_INTERVAL_SECONDS') ?? 300,
      },
      openInterest: {
        enabled: configService.get<boolean>('MARKET_OPEN_INTEREST_ENABLED') ?? true,
        pollIntervalSeconds: configService.get<number>('MARKET_OPEN_INTEREST_POLL_INTERVAL_SECONDS') ?? 60,
      },
      staleAfterSeconds: configService.get<number>('MARKET_STALE_AFTER_SECONDS') ?? 30,
      reconnect: {
        baseDelayMs: configService.get<number>('MARKET_RECONNECT_BASE_DELAY_MS') ?? 500,
        maxDelayMs: configService.get<number>('MARKET_RECONNECT_MAX_DELAY_MS') ?? 30000,
        maxAttempts: configService.get<number>('MARKET_MAX_RECONNECT_ATTEMPTS') ?? 0,
      },
      persistence: {
        batchSize: configService.get<number>('MARKET_WRITE_BATCH_SIZE') ?? 100,
        flushIntervalMs: configService.get<number>('MARKET_WRITE_FLUSH_INTERVAL_MS') ?? 1000,
      },
    };

    this.logger.log({
      event: 'market_data_config_loaded',
      enabled: this.config.enabled,
      providers: this.config.providers,
      symbols: this.config.symbols,
      intervals: this.config.intervals,
    });
  }

  getConfig(): MarketDataConfig {
    return this.config;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }
}
