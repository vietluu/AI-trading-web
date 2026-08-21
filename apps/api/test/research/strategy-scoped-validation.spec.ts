import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { validationBacktestStrategy } from '../../src/modules/research/application/research.service';
import { ResearchService } from '../../src/modules/research/application/research.service';
import { ExchangeInterval, ExchangeProvider } from '../../src/exchange/domain/exchange.types';

describe('strategy-scoped quant validation', () => {
  it.each([
    ['ai-core', 'HYBRID_QUANT'],
    ['trend', 'TREND_FOLLOWING'],
    ['mean-reversion', 'RSI_MEAN_REVERSION'],
    ['breakout', 'BREAKOUT'],
    ['momentum-scalp', 'MOMENTUM_STRATEGY'],
  ])('maps %s to its own backtest policy', (key, expected) => {
    expect(validationBacktestStrategy(key)).toBe(expected);
  });

  it('does not manufacture candle-only evidence for news strategy', () => {
    expect(() => validationBacktestStrategy('news')).toThrow(BadRequestException);
  });

  it('refreshes requested symbol and strategy pairs with explicit per-pair outcomes', async () => {
    const service = new ResearchService({} as never);
    vi.spyOn(service, 'runFullQuantValidation').mockImplementation((input) =>
      input.strategyKey === 'momentum-scalp'
        ? Promise.reject(new BadRequestException('DATA_UNAVAILABLE: 4/30 trades'))
        : Promise.resolve({ validationRunId: `${input.symbol}:${input.strategyKey}` } as never),
    );

    const result = await service.refreshFullQuantValidations({
      userId: 'user-1',
      provider: ExchangeProvider.OKX_FUTURES,
      symbols: ['btc-usdt'],
      interval: ExchangeInterval.FIFTEEN_MINUTES,
      strategyKeys: ['trend', 'momentum-scalp'],
    });

    expect(result).toMatchObject({ requested: 2, completed: 1, unavailable: 1 });
    expect(result.results).toEqual([
      expect.objectContaining({ symbol: 'BTC-USDT', strategyKey: 'trend', status: 'COMPLETED' }),
      expect.objectContaining({ symbol: 'BTC-USDT', strategyKey: 'momentum-scalp', status: 'DATA_UNAVAILABLE' }),
    ]);
  });
});
