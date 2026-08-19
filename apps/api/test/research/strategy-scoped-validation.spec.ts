import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { validationBacktestStrategy } from '../../src/modules/research/application/research.service';

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
});
