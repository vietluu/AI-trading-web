import { describe, it, expect } from 'vitest';
import { predictDerivativesImbalance, type DerivativesInput } from '../src/modules/agents/domain/analysis/derivatives-imbalance-predictor';

describe('Derivatives Imbalance Predictor', () => {
  it('Extreme negative funding => SHORT_SQUEEZE', () => {
    const input: DerivativesInput = {
      currentFundingRate: -0.05,
      historicalFundingRates: [-0.01, -0.02, 0.01, 0.02, 0.03, -0.01, 0.0, 0.0, 0.0, 0.0],
      currentOI: 100,
      historicalOpenInterest: [100, 100],
      priceChange: 0,
      oiTrend: 'FLAT',
      fundingTrend: 'FALLING'
    };
    
    const result = predictDerivativesImbalance(input);
    expect(result.coverage).toBe('AVAILABLE');
    if (result.coverage !== 'AVAILABLE') throw new Error('expected available result');
    expect(result.fundingExtreme).toBe('EXTREME_NEGATIVE');
    expect(result.squeezeDirection).toBe('SHORT_SQUEEZE');
    expect(result.squeezeProbability).toBeGreaterThanOrEqual(40);
    expect(result.signals.some(s => s.includes('extremely negative'))).toBe(true);
  });

  it('Extreme positive funding => LONG_SQUEEZE', () => {
    const input: DerivativesInput = {
      currentFundingRate: 0.05,
      historicalFundingRates: [-0.01, -0.02, 0.01, 0.02, 0.03, -0.01, 0.0, 0.0, 0.0, 0.0],
      currentOI: 100,
      historicalOpenInterest: [100, 100],
      priceChange: 0,
      oiTrend: 'FLAT',
      fundingTrend: 'RISING'
    };
    
    const result = predictDerivativesImbalance(input);
    expect(result.coverage).toBe('AVAILABLE');
    if (result.coverage !== 'AVAILABLE') throw new Error('expected available result');
    expect(result.fundingExtreme).toBe('EXTREME_POSITIVE');
    expect(result.squeezeDirection).toBe('LONG_SQUEEZE');
    expect(result.squeezeProbability).toBeGreaterThanOrEqual(40);
  });

  it('Normal funding => NONE', () => {
    const input: DerivativesInput = {
      currentFundingRate: 0.0,
      historicalFundingRates: [-0.01, -0.02, 0.01, 0.02, 0.03, -0.01, 0.0, 0.0, 0.0, 0.0],
      currentOI: 100,
      historicalOpenInterest: [100, 100],
      priceChange: 0,
      oiTrend: 'FLAT',
      fundingTrend: 'FLAT'
    };
    
    const result = predictDerivativesImbalance(input);
    expect(result.coverage).toBe('AVAILABLE');
    if (result.coverage !== 'AVAILABLE') throw new Error('expected available result');
    expect(result.fundingExtreme).toBe('NORMAL');
    expect(result.squeezeDirection).toBe('NONE');
    expect(result.signals).toContain('Market appears balanced.');
  });

  it('OI divergence cases', () => {
    const input: DerivativesInput = {
      currentFundingRate: 0.0,
      historicalFundingRates: [-0.01, -0.02, 0.01, 0.02, 0.03, -0.01, 0.0, 0.0, 0.0, 0.0],
      currentOI: 110,
      historicalOpenInterest: [100, 110], // +10%
      priceChange: 0.5,
      oiTrend: 'RISING',
      fundingTrend: 'FLAT'
    };
    
    let result = predictDerivativesImbalance(input);
    expect(result.coverage).toBe('AVAILABLE');
    if (result.coverage !== 'AVAILABLE') throw new Error('expected available result');
    expect(result.oiPriceDivergence).toBe('OI_RISING_PRICE_FLAT');
    
    input.priceChange = -1.5;
    result = predictDerivativesImbalance(input);
    if (result.coverage !== 'AVAILABLE') throw new Error('expected available result');
    expect(result.oiPriceDivergence).toBe('OI_RISING_PRICE_FALLING');
    
    input.currentOI = 90; // -10%
    input.historicalOpenInterest = [100, 90];
    input.priceChange = 1.5;
    result = predictDerivativesImbalance(input);
    if (result.coverage !== 'AVAILABLE') throw new Error('expected available result');
    expect(result.oiPriceDivergence).toBe('OI_FALLING_PRICE_RISING');
  });

  it('Insufficient data handling', () => {
    const input: DerivativesInput = {
      currentFundingRate: 0.0,
      historicalFundingRates: [], // < 5 items
      currentOI: 100,
      historicalOpenInterest: [100], // < 2 items
      priceChange: 0,
      oiTrend: 'FLAT',
      fundingTrend: 'FLAT'
    };
    
    const result = predictDerivativesImbalance(input);
    expect(result).toEqual({
      coverage: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_DERIVATIVES_HISTORY',
      unavailableFields: ['fundingRatePercentile', 'oiPriceDivergence'],
    });
  });

  it('squeezeProbability range and signals array populated', () => {
    const input: DerivativesInput = {
      currentFundingRate: -0.05, // extreme negative
      historicalFundingRates: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      currentOI: 110, // rising OI
      historicalOpenInterest: [100, 110],
      priceChange: 0.5, // flat price => OI_RISING_PRICE_FLAT
      oiTrend: 'RISING',
      fundingTrend: 'FALLING'
    };
    
    const result = predictDerivativesImbalance(input);
    expect(result.coverage).toBe('AVAILABLE');
    if (result.coverage !== 'AVAILABLE') throw new Error('expected available result');
    // Extreme (-40) + OI_RISING_PRICE_FLAT (30) + Rising OI (15) = 85
    expect(result.squeezeProbability).toBeGreaterThan(0);
    expect(result.squeezeProbability).toBeLessThanOrEqual(100);
    expect(result.signals.length).toBeGreaterThan(1);
  });
});
