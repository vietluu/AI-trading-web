import { ConfigService } from '@nestjs/config';
import type { DecisionOutput } from '@platform/shared';
import { describe, expect, it, vi } from 'vitest';
import { SentimentMarketGetTool } from '../../src/modules/ai-tools/infrastructure/tools/news-tools';
import { DecisionJudgeService } from '../../src/modules/pipeline/application/decision-judge.service';
import { PipelineAlertService } from '../../src/modules/pipeline/application/pipeline-alert.service';
import { QuantExecutionPolicyService } from '../../src/modules/pipeline/application/quant-execution-policy.service';
import {
  analyzeMultiTimeframe,
  evaluateMultiTimeframeDecision,
} from '../../src/modules/pipeline/domain/multi-timeframe-analysis';
import { RiskConfigService } from '../../src/modules/risk/application/risk-config.service';
import { evaluateRisk } from '../../src/modules/risk/domain/risk-engine';

const directionalDecision = (): DecisionOutput => ({
  decision: 'LONG', confidence: 80, reasoning: 'audit simulation',
  signals: { bullishFactors: [], bearishFactors: [] }, risks: [], agreementScore: 80,
  dataQuality: 'GOOD', regime: { type: 'TRENDING' },
  weighting: { market: 20, technical: 30, news: 10, sentiment: 15, macro: 15, onchain: 10 },
  overrides: [], volatilityAdjustment: 0, conflictLevel: 'LOW', opportunityScore: 75,
  expectedWinProbability: 0.6, expectedReward: 2, expectedLoss: 1, expectedValue: 0.7,
  profitFactorEstimate: 1.8, riskScore: 30, adaptiveThreshold: 70,
  calibrationAdjustment: 0, executionCost: 0.05, generatedAt: new Date().toISOString(),
});

describe('live trading checklist simulation', () => {
  it('DATA: rejects a directional decision when the source candle is stale', () => {
    const now = Date.parse('2026-08-12T10:00:00.000Z');
    const good = { dataQuality: 'GOOD', generatedAt: new Date(now).toISOString() };
    const result = new DecisionJudgeService().evaluate(
      directionalDecision(),
      { market: good, technical: good, news: good, sentiment: good, macro: good, onchain: good } as never,
      { symbol: 'BTC-USDT', timeframe: '5m', sourceTimestamp: '2026-08-12T09:40:00.000Z' },
      now,
    );
    expect(result).toMatchObject({ approved: false, verdict: 'REQUEST_MORE_DATA' });
    expect(result.reasons).toContain('STALE_SOURCE_DATA');
  });

  it('PIPELINE: rejects a LONG candidate opposed by weighted timeframes', () => {
    const analysis = analyzeMultiTimeframe('15m', [
      { timeframe: '5m', close: 99, ema20: 100, ema50: 101 },
      { timeframe: '15m', close: 99, ema20: 100, ema50: 101 },
      { timeframe: '1h', close: 98, ema20: 100, ema50: 102 },
    ]);
    expect(evaluateMultiTimeframeDecision('LONG', analysis)).toMatchObject({
      allowed: false,
      reason: 'MULTI_TIMEFRAME_CONFLICT',
    });
  });

  it('QUANT: refuses validation created from only five independent trades', async () => {
    const validation = {
      probabilityOfProfit: 80, probabilityOfRuin: 0, outOfSampleSharpe: 2,
      walkForwardStable: true, confidenceBrierScore: 0.1, createdAt: new Date('2026-08-12T09:00:00Z'),
      metricsJson: {
        sampleEvidence: { totalTrades: 5, outOfSampleTrades: 1, walkForwardWindows: 1 },
        outOfSample: { outOfSampleTrades: 1 }, walkForward: { windows: [{}] },
        executionAssumptions: { leverage: 50, riskPerTrade: 0.02, riskRewardRatio: 1.5 },
      },
    };
    const prisma = {
      researchValidationRun: { findFirst: vi.fn().mockResolvedValue(validation) },
      marketRegimeState: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const result = await new QuantExecutionPolicyService(prisma as never).evaluate({
      userId: 'user-1', symbol: 'ETH-USDT', provider: 'OKX_FUTURES', timeframe: '15m',
      strategyKey: 'ai-core', decision: directionalDecision(), now: new Date('2026-08-12T10:00:00Z'),
    });
    expect(result).toMatchObject({ allowed: false, reason: 'QUANT_SAMPLE_TOO_SMALL' });
  });

  it('RISK: caps AGGRESSIVE user risk and planned loss at the numeric ceiling', async () => {
    const prisma = { userSetting: { findUnique: vi.fn().mockResolvedValue({
      riskPreference: 'AGGRESSIVE', defaultLeverage: 50, maxRiskPerTrade: 0.0125,
    }) } };
    const config = new RiskConfigService(new ConfigService({
      MAX_LEVERAGE: 50,
      MAX_STOP_LOSS_ROE: 0.05,
    }), prisma as never);
    const limits = await config.getUserLimits('user-1');
    const result = evaluateRisk({
      symbol: 'BTC-USDT', decision: directionalDecision(),
      account: { balance: 10_000, equity: 10_000, peakEquity: 10_000 },
      currentPositions: [], marketData: { price: 50_000, volatility: 0.02 },
      now: new Date('2026-08-12T10:00:00Z'),
    }, limits);
    expect(limits.riskPerTrade).toBe(0.0125);
    expect(result.approved).toBe(true);
    expect(result.plannedEquityRiskPct).toBeLessThanOrEqual(0.0125);
  });

  it('SENTIMENT: labels Fear and Greed as global context, not symbol evidence', async () => {
    const prisma = { marketSentimentObservation: { findFirst: vi.fn().mockResolvedValue({
      value: 27, classification: 'Fear', observedAt: new Date(), provider: 'alternative.me', indexType: 'FEAR_GREED',
    }) } };
    const result = await new SentimentMarketGetTool(prisma as never).execute(
      { symbol: 'ZRO-USDT' }, {} as never,
    );
    expect(result).toMatchObject({
      scope: 'GLOBAL_CRYPTO_MARKET', symbolApplicability: 'CONTEXT_ONLY', requestedSymbol: 'ZRO-USDT',
    });
    expect(result).not.toHaveProperty('symbol');
  });

  it('EXECUTION: never emits an actionable alert for a final WAIT', async () => {
    const create = vi.fn();
    const service = new PipelineAlertService(
      { pipelineAlert: { create } } as never,
      { minConfidence: 70 } as never,
    );
    await service.decision('run-1', 'BTC-USDT', { ...directionalDecision(), decision: 'WAIT' });
    expect(create).not.toHaveBeenCalled();
  });
});
