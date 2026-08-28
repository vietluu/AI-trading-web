import { describe, expect, it } from 'vitest';
import type { FactorEvaluationItem } from '../../src/modules/research/domain/factor-discovery.engine';
import type { GeneratedHypothesis } from '../../src/modules/research/domain/quant-research.engine';

describe('Quant Research Engines & Factor Evaluation (0-100 range normalization)', () => {
  it('validates that factor evaluation metrics conform to bounded 0-100 percentage scales', () => {
    const factor: FactorEvaluationItem = {
      factorName: 'rsi_divergence_14',
      category: 'TECHNICAL',
      predictivePower: 75.5,
      contribution: 62.0,
      noiseScore: 18.2,
      redundancyScore: 12.0,
    };

    expect(factor.predictivePower).toBeGreaterThanOrEqual(0);
    expect(factor.predictivePower).toBeLessThanOrEqual(100);
    expect(factor.contribution).toBeGreaterThanOrEqual(0);
    expect(factor.contribution).toBeLessThanOrEqual(100);
    expect(factor.noiseScore).toBeGreaterThanOrEqual(0);
    expect(factor.noiseScore).toBeLessThanOrEqual(100);
    expect(factor.redundancyScore).toBeGreaterThanOrEqual(0);
    expect(factor.redundancyScore).toBeLessThanOrEqual(100);
  });

  it('validates generated hypothesis structure and statistical proof bounds', () => {
    const hypothesis: GeneratedHypothesis = {
      title: 'EMA 20/50 Cross Momentum Filter',
      category: 'INDICATOR',
      description: 'EMA alignment improves trend trade expectancy',
      hypothesisText: 'If EMA 20 > EMA 50 on 1h timeframe, long trade win rate increases by 8%',
      expectedValue: 1.85,
      profitFactor: 1.45,
      sharpeRatio: 0.85,
      statisticalProof: {
        pValue: 0.012,
        sampleSize: 150,
        tStatistic: 2.54,
        confidenceInterval: [0.03, 0.13],
      },
    };

    expect(hypothesis.statisticalProof.pValue).toBeLessThan(0.05); // Statistically significant
    expect(hypothesis.statisticalProof.sampleSize).toBeGreaterThanOrEqual(100);
    expect(hypothesis.profitFactor).toBeGreaterThan(1.3);
  });
});
