import { describe, it, expect } from 'vitest';
import {
  classifyExecutionEvidence,
} from '../../src/modules/pipeline/domain/execution-cohort';

describe('ExecutionCohort Matcher', () => {
  const baseNow = new Date('2026-09-14T12:00:00Z');

  const baseRequest = {
    symbol: 'BTC-USDT',
    strategyKey: 'ai-core',
    direction: 'LONG' as const,
    regime: 'BULL',
    timeframe: '15m',
    executionPolicy: 'DEFAULT',
    configurationVersion: 1,
    userLimits: {
      maxLeverage: 2,
      riskPerTrade: 0.02,
      riskRewardRatio: 2.0,
    },
  };

  const createValidation = (overrides: Record<string, unknown> = {}) => ({
    symbol: 'BTC-USDT',
    strategyKey: 'ai-core',
    interval: '15m',
    probabilityOfProfit: 60,
    probabilityOfRuin: 5,
    outOfSampleSharpe: 1.5,
    walkForwardStable: true,
    confidenceBrierScore: 0.15,
    createdAt: new Date('2026-09-14T10:00:00Z'),
    metricsJson: {
      direction: 'LONG',
      regime: 'BULL',
      executionPolicy: 'DEFAULT',
      configurationVersion: 1,
      sampleEvidence: { totalTrades: 45, outOfSampleTrades: 15 },
      outOfSample: { outOfSampleTrades: 15 },
      executionAssumptions: {
        leverage: 2,
        riskPerTrade: 0.02,
        riskRewardRatio: 2.0,
      },
    },
    ...overrides,
  });

  it('classifies exact mature positive evidence', () => {
    const val = createValidation();
    const result = classifyExecutionEvidence(baseRequest, val, baseNow);
    expect(result.status).toBe('EXACT_MATURE_POSITIVE');
    expect(result.matchedCohort).toEqual({
      symbol: 'BTC-USDT',
      strategyKey: 'ai-core',
      direction: 'LONG',
      regime: 'BULL',
      timeframe: '15m',
      executionPolicy: 'DEFAULT',
      configurationVersion: 1,
    });
  });

  it('classifies exact immature evidence when trade counts are low', () => {
    const val = createValidation({
      metricsJson: {
        direction: 'LONG',
        regime: 'BULL',
        executionPolicy: 'DEFAULT',
        configurationVersion: 1,
        sampleEvidence: { totalTrades: 20, outOfSampleTrades: 5 },
        outOfSample: { outOfSampleTrades: 5 },
        executionAssumptions: {
          leverage: 2,
          riskPerTrade: 0.02,
          riskRewardRatio: 2.0,
        },
      },
    });
    const result = classifyExecutionEvidence(baseRequest, val, baseNow);
    expect(result.status).toBe('EXACT_IMMATURE');
  });

  it('returns PARTIAL_MATCH on direction mismatch', () => {
    const val = createValidation({
      metricsJson: {
        direction: 'SHORT',
        regime: 'BULL',
        executionPolicy: 'DEFAULT',
        configurationVersion: 1,
        sampleEvidence: { totalTrades: 50, outOfSampleTrades: 20 },
        executionAssumptions: {
          leverage: 2,
          riskPerTrade: 0.02,
          riskRewardRatio: 2.0,
        },
      },
    });
    const result = classifyExecutionEvidence(baseRequest, val, baseNow);
    expect(result.status).toBe('PARTIAL_MATCH');
  });

  it('returns PARTIAL_MATCH on regime mismatch', () => {
    const val = createValidation({
      metricsJson: {
        direction: 'LONG',
        regime: 'BEAR',
        executionPolicy: 'DEFAULT',
        configurationVersion: 1,
        sampleEvidence: { totalTrades: 50, outOfSampleTrades: 20 },
        executionAssumptions: {
          leverage: 2,
          riskPerTrade: 0.02,
          riskRewardRatio: 2.0,
        },
      },
    });
    const result = classifyExecutionEvidence(baseRequest, val, baseNow);
    expect(result.status).toBe('PARTIAL_MATCH');
  });

  it('returns PARTIAL_MATCH on timeframe mismatch (1h validation for 15m request)', () => {
    const val = createValidation({
      interval: '1h',
    });
    const result = classifyExecutionEvidence(baseRequest, val, baseNow);
    expect(result.status).toBe('PARTIAL_MATCH');
  });

  it('returns PARTIAL_MATCH on execution-policy mismatch', () => {
    const val = createValidation({
      metricsJson: {
        direction: 'LONG',
        regime: 'BULL',
        executionPolicy: 'AGGRESSIVE_BREAKOUT',
        configurationVersion: 1,
        sampleEvidence: { totalTrades: 50, outOfSampleTrades: 20 },
        executionAssumptions: {
          leverage: 2,
          riskPerTrade: 0.02,
          riskRewardRatio: 2.0,
        },
      },
    });
    const result = classifyExecutionEvidence(baseRequest, val, baseNow);
    expect(result.status).toBe('PARTIAL_MATCH');
  });

  it('returns PARTIAL_MATCH when identity fields are missing in metricsJson', () => {
    const val = createValidation({
      metricsJson: {
        // direction, regime, etc. missing
        sampleEvidence: { totalTrades: 50, outOfSampleTrades: 20 },
      },
    });
    const result = classifyExecutionEvidence(baseRequest, val, baseNow);
    expect(result.status).toBe('PARTIAL_MATCH');
  });

  it('returns PARTIAL_MATCH when execution cost assumptions mismatch user limits', () => {
    const val = createValidation({
      metricsJson: {
        direction: 'LONG',
        regime: 'BULL',
        executionPolicy: 'DEFAULT',
        configurationVersion: 1,
        sampleEvidence: { totalTrades: 50, outOfSampleTrades: 20 },
        executionAssumptions: {
          leverage: 5, // userLimit is 2
          riskPerTrade: 0.02,
          riskRewardRatio: 2.0,
        },
      },
    });
    const result = classifyExecutionEvidence(baseRequest, val, baseNow);
    expect(result.status).toBe('PARTIAL_MATCH');
  });

  it('returns STALE when validation exceeds maximum age', () => {
    const val = createValidation({
      createdAt: new Date('2026-09-10T00:00:00Z'), // > 36h old
    });
    const result = classifyExecutionEvidence(baseRequest, val, baseNow);
    expect(result.status).toBe('STALE');
  });

  it('returns MISSING when validation is null or undefined', () => {
    expect(classifyExecutionEvidence(baseRequest, null, baseNow).status).toBe('MISSING');
    expect(classifyExecutionEvidence(baseRequest, undefined, baseNow).status).toBe('MISSING');
  });

  describe('mature negative cases', () => {
    it('returns EXACT_MATURE_NEGATIVE when walkForwardStable is false', () => {
      const val = createValidation({ walkForwardStable: false });
      const result = classifyExecutionEvidence(baseRequest, val, baseNow);
      expect(result.status).toBe('EXACT_MATURE_NEGATIVE');
    });

    it('returns EXACT_MATURE_NEGATIVE when probabilityOfProfit < 52', () => {
      const val = createValidation({ probabilityOfProfit: 49 });
      const result = classifyExecutionEvidence(baseRequest, val, baseNow);
      expect(result.status).toBe('EXACT_MATURE_NEGATIVE');
    });

    it('returns EXACT_MATURE_NEGATIVE when probabilityOfRuin > 15', () => {
      const val = createValidation({ probabilityOfRuin: 18 });
      const result = classifyExecutionEvidence(baseRequest, val, baseNow);
      expect(result.status).toBe('EXACT_MATURE_NEGATIVE');
    });

    it('returns EXACT_MATURE_NEGATIVE when outOfSampleSharpe <= 0.8', () => {
      const val = createValidation({ outOfSampleSharpe: 0.75 });
      const result = classifyExecutionEvidence(baseRequest, val, baseNow);
      expect(result.status).toBe('EXACT_MATURE_NEGATIVE');
    });
  });
});
