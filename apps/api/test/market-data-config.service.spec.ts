import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { MarketDataConfigService } from '../src/market-data/application/market-data-config.service';
import {
  ExchangeInterval,
  ExchangeProvider,
} from '../src/exchange/domain/exchange.types';

describe('MarketDataConfigService', () => {
  it('accepts list values produced by environment validation', () => {
    const config = new MarketDataConfigService(
      new ConfigService({
        MARKET_DATA_ENABLED: true,
        MARKET_DATA_PROVIDERS: ['BINANCE_FUTURES', 'OKX_FUTURES'],
        MARKET_DATA_SYMBOLS: ['BTC-USDT', 'ETH-USDT'],
        MARKET_DATA_INTERVALS: ['1m', '1h'],
      }),
    ).getConfig();

    expect(config.providers).toEqual([
      ExchangeProvider.BINANCE_FUTURES,
      ExchangeProvider.OKX_FUTURES,
    ]);
    expect(config.symbols).toEqual(['BTC-USDT', 'ETH-USDT']);
    expect(config.intervals).toEqual([
      ExchangeInterval.ONE_MINUTE,
      ExchangeInterval.ONE_HOUR,
    ]);
  });

  it('also accepts comma-separated values for isolated use', () => {
    const config = new MarketDataConfigService(
      new ConfigService({
        MARKET_DATA_PROVIDERS: 'BINANCE_FUTURES',
        MARKET_DATA_SYMBOLS: 'BTC-USDT',
        MARKET_DATA_INTERVALS: '5m',
      }),
    ).getConfig();

    expect(config.providers).toEqual([ExchangeProvider.BINANCE_FUTURES]);
    expect(config.symbols).toEqual(['BTC-USDT']);
    expect(config.intervals).toEqual([ExchangeInterval.FIVE_MINUTES]);
  });
});
