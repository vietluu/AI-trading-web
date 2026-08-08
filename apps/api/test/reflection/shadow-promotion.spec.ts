import { describe, expect, it } from 'vitest';
import {
  EMPTY_SHADOW_PERFORMANCE,
  addShadowReturn,
  evaluateShadowPromotion,
  type ShadowPerformance,
} from '../../src/modules/reflection/application/self-learning.service';

function performance(overrides: Partial<ShadowPerformance>): ShadowPerformance {
  return { ...EMPTY_SHADOW_PERFORMANCE, ...overrides };
}

describe('shadow learning statistics', () => {
  it('tracks profit factor and peak-to-trough drawdown incrementally', () => {
    const afterWin = addShadowReturn(EMPTY_SHADOW_PERFORMANCE, 4, true);
    const afterLoss = addShadowReturn(afterWin, -3, false);

    expect(afterLoss).toMatchObject({
      tradesCount: 2,
      correctCount: 1,
      totalReturn: 1,
      grossProfit: 4,
      grossLoss: 3,
      maxDrawdown: 3,
    });
    expect(afterLoss.profitFactor).toBeCloseTo(4 / 3);
    expect(Number.isFinite(afterLoss.sharpeRatio)).toBe(true);
  });

  it('promotes only a statistically stronger, profitable and controlled candidate', () => {
    const live = performance({
      tradesCount: 100,
      correctCount: 55,
      accuracy: 55,
      totalReturn: 8,
      profitFactor: 1.1,
      maxDrawdown: 8,
    });
    const strongShadow = performance({
      tradesCount: 100,
      correctCount: 72,
      accuracy: 72,
      totalReturn: 20,
      profitFactor: 1.8,
      sharpeRatio: 1.1,
      maxDrawdown: 5,
    });
    const rules = {
      minTrades: 100,
      minAccuracyLift: 3,
      minProfitFactor: 1.2,
      minSharpeRatio: 0.5,
      maxDrawdown: 10,
    };

    expect(evaluateShadowPromotion(strongShadow, live, rules).promote).toBe(true);
    expect(evaluateShadowPromotion({ ...strongShadow, maxDrawdown: 15 }, live, rules).promote).toBe(false);
    expect(evaluateShadowPromotion({ ...strongShadow, sharpeRatio: 0.2 }, live, rules).promote).toBe(false);
    expect(evaluateShadowPromotion({ ...strongShadow, tradesCount: 49 }, live, rules).promote).toBe(false);
  });
});
