import { describe, expect, it } from 'vitest';
import type { DecisionInput } from '@platform/shared';

import { DecisionService } from '../../src/modules/agents/application/services/decision.service';
import { buildExecutionContext } from '../../src/modules/pipeline/domain/execution-context';
import { evaluateRisk, type RiskLimits } from '../../src/modules/risk/domain/risk-engine';
import { createBaseSnapshot } from '../helpers/thesis-fixture';

function input(): DecisionInput {
  const generatedAt = new Date().toISOString();
  const market = {
    summary: 'Market is neutral before the event.', trend: { direction: 'SIDEWAYS' as const, strength: 'MODERATE' as const },
    volatility: { level: 'MEDIUM' as const, atr: '200' }, liquidity: {}, derivatives: {}, anomalies: [],
    dataQuality: 'GOOD' as const, usedTools: ['market.ticker.get' as const], generatedAt,
  };
  const technical = {
    summary: 'Technicals are lagging and neutral.', trend: { direction: 'SIDEWAYS' as const, strength: 'MODERATE' as const },
    momentum: { rsi: '50', rsiState: 'NEUTRAL' as const, macd: { trend: 'NEUTRAL' as const } },
    movingAverages: { alignment: 'MIXED' as const, pricePosition: 'INSIDE' as const },
    volatility: { bollinger: { position: 'MIDDLE' as const, squeeze: false } }, structure: { marketStructure: 'RANGE' as const },
    divergence: {}, signals: [], dataQuality: 'GOOD' as const, usedTools: ['market.indicators.get' as const], generatedAt,
  };
  const news = {
    summary: 'Fresh confirmed positive event.', impact: { level: 'HIGH' as const, direction: 'POSITIVE' as const },
    keyEvents: [{ title: 'Approval', impact: 'POSITIVE' as const, importance: 90 }], themes: [], riskSignals: [],
    dataQuality: 'GOOD' as const, usedTools: ['news.articles.list' as const],
    latestPublishedAt: generatedAt, generatedAt,
  };
  const fusionOutput = {
    summary: 'News-led positive setup.', combinedAnalysis: { market: market.summary, technical: technical.summary, news: news.summary, sentiment: '', macro: '', onchain: '' },
    overallBias: 'BULLISH' as const, confidence: 80, conflicts: [], dataQuality: 'GOOD' as const, generatedAt,
  };
  return { symbol: 'BTC-USDT', fusionOutput, market, technical, news };
}

const limits: RiskLimits = {
  riskPerTrade: 0.02, maxPositions: 3, maxLeverage: 3, maxDrawdown: 0.15, maxExposure: 1, cooldownMs: 60_000,
  minimumConfidence: 60, stopLossPct: 0.02, riskRewardRatio: 2, highVolatility: 0.04, abnormalVolatility: 0.15,
  highVolatilitySizeFactor: 0.6, estimatedRoundTripCostPct: 0.0008, maxStopLossRoe: 0.03,
  rangeScalpRoeMultiplier: 2, minLiquidationBufferPct: 0.01,
};

function executionContext() {
  return buildExecutionContext({
    regime: 'RANGING', setup: 'RANGE_REVERSION', action: 'ENTER', price: 108_200,
    support: 108_000, resistance: 112_000, atr: 200, sourceDataCutoff: new Date().toISOString(),
    primaryCandleClosed: true, triggerConfirmed: true,
  });
}

function authority(sourceIds: string[], withOi = true) {
  return {
    news: { importance: 90, confidence: 90, direction: 'POSITIVE' as const, sourceIds, publishedAt: new Date().toISOString() },
    causality: { priceChangePercent: 2, volumeRatio: 1.6, ...(withOi ? { deltaOiPercent: 1.2 } : {}) },
  };
}

describe('news probe production chain', () => {
  it('rejects uncorroborated news before it can produce a risk candidate', async () => {
    const decision = await new DecisionService({} as never).decideForUser(input(), undefined, {
      anticipatorySnapshot: createBaseSnapshot(), executionContext: executionContext(), newsProbeAuthority: authority([], false),
    });

    expect(decision.decision).toBe('WAIT');
    expect(decision.overrides).toContain('NEWS_CORROBORATION_INSUFFICIENT');
  });

  it('propagates genuinely corroborated fresh news through non-exact calibration as a 0.15 probe', async () => {
    const decision = await new DecisionService({} as never).decideForUser(input(), undefined, {
      anticipatorySnapshot: createBaseSnapshot(), executionContext: executionContext(), newsProbeAuthority: authority(['reuters']),
    });

    expect(decision).toMatchObject({ decision: 'LONG', executionContext: { action: 'PROBE', riskTier: 'PROBE' }, thesis: { action: 'PROBE' } });
    expect(decision.confidenceCalibration).toMatchObject({
      status: 'INSUFFICIENT_HISTORY',
      // No exact cohort owns this decision, so news authority is bounded to a
      // probe even though the market corroboration is genuine.
      fallbackUsed: false,
      scope: 'NONE',
      hardGateEligible: false,
    });
    const risk = evaluateRisk({
      symbol: 'BTC-USDT', decision, account: { balance: 10_000, equity: 10_000, peakEquity: 10_000 }, currentPositions: [],
      marketData: { price: 108_200, volatility: 0.02 }, now: new Date(),
    }, limits);
    expect(risk.tradePlan).toMatchObject({ riskTier: 'PROBE', sizeFactor: 0.15 });
  });
});
