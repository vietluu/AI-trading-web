import { describe, expect, it } from 'vitest';
import type { DecisionInput, FusionInput, FusionOutput } from '@platform/shared';
import { DecisionService } from '../../src/modules/agents/application/services/decision.service';
import { DecisionJudgeService } from '../../src/modules/pipeline/application/decision-judge.service';
import {
  assetLiquidityClass,
  isAltcoin,
  isMajorAsset,
} from '../../src/modules/pipeline/domain/adaptive-trading-policy';

function createAnalyses(overrides?: Partial<FusionInput>): FusionInput {
  const generatedAt = new Date().toISOString();
  return {
    market: {
      summary: 'Market trend is rising with good liquidity.',
      trend: { direction: 'UP', strength: 'STRONG' },
      volatility: { level: 'MEDIUM', atr: '2.0' },
      liquidity: {},
      derivatives: {},
      anomalies: [],
      dataQuality: 'GOOD',
      usedTools: ['market.ticker.get'],
      generatedAt,
      ...(overrides?.market ?? {}),
    },
    technical: {
      summary: 'Technical momentum is bullish and aligned with trend.',
      trend: { direction: 'UP', strength: 'STRONG' },
      momentum: { rsi: '60', rsiState: 'NEUTRAL', macd: { trend: 'BULLISH' } },
      movingAverages: { alignment: 'BULLISH', pricePosition: 'ABOVE' },
      volatility: { bollinger: { position: 'MIDDLE', squeeze: false } },
      structure: { marketStructure: 'HH_HL' },
      divergence: {},
      signals: [],
      dataQuality: 'GOOD',
      usedTools: ['market.indicators.get'],
      generatedAt,
      ...(overrides?.technical ?? {}),
    },
    news: {
      summary: 'Positive ecosystem news development.',
      impact: { level: 'HIGH', direction: 'POSITIVE' },
      keyEvents: [],
      themes: [],
      riskSignals: [],
      dataQuality: 'GOOD',
      usedTools: ['news.articles.list'],
      generatedAt,
      ...(overrides?.news ?? {}),
      latestPublishedAt: overrides?.news?.latestPublishedAt ?? null,
    },
    sentiment: {
      summary: 'Insufficient social coverage for altcoin.',
      sentiment: { overall: 'NEUTRAL', intensity: 'LOW' },
      crowdBehavior: { fomo: false, panic: false, euphoria: false },
      sources: {},
      anomalies: [],
      dataQuality: 'INSUFFICIENT',
      usedTools: [],
      generatedAt,
      ...(overrides?.sentiment ?? {}),
    },
    macro: {
      summary: 'no imported macro data',
      macroTrend: 'NEUTRAL',
      keyEvents: [],
      riskFactors: [],
      dataQuality: 'INSUFFICIENT',
      generatedAt,
      ...(overrides?.macro ?? {}),
    },
    onchain: {
      summary: 'no verified on-chain analysis for asset',
      activity: 'LOW',
      flows: {},
      signals: ['no verified on-chain analysis'],
      dataQuality: 'INSUFFICIENT',
      generatedAt,
      ...(overrides?.onchain ?? {}),
    },
  };
}

function createFusionOutput(analyses: FusionInput): FusionOutput {
  return {
    summary: 'Consensus is strongly bullish based on core triad.',
    combinedAnalysis: {
      market: analyses.market.summary,
      technical: analyses.technical.summary,
      news: analyses.news?.summary ?? '',
      sentiment: analyses.sentiment?.summary ?? '',
      macro: analyses.macro?.summary ?? '',
      onchain: analyses.onchain?.summary ?? '',
    },
    overallBias: 'BULLISH',
    confidence: 85,
    conflicts: [],
    dataQuality: 'GOOD',
    generatedAt: new Date().toISOString(),
  };
}

describe('Altcoin Liquidity Tiers & Protection Policies', () => {
  const decisionService = new DecisionService({} as never);
  const judgeService = new DecisionJudgeService();

  describe('Asset Liquidity Helpers', () => {
    it('accurately identifies Majors vs Altcoins', () => {
      expect(isMajorAsset('BTC-USDT')).toBe(true);
      expect(isMajorAsset('ETH-USDT')).toBe(true);
      expect(isAltcoin('BTC-USDT')).toBe(false);
      expect(isAltcoin('ETH-USDT')).toBe(false);

      expect(isAltcoin('SOL-USDT')).toBe(true);
      expect(isAltcoin('ZEC-USDT')).toBe(true);
      expect(isAltcoin('ARB-USDT')).toBe(true);
      expect(isAltcoin('PEPE-USDT')).toBe(true);
      expect(isMajorAsset('ZEC-USDT')).toBe(false);

      expect(assetLiquidityClass('BTC-USDT')).toBe('MAJOR');
      expect(assetLiquidityClass('SOL-USDT')).toBe('LIQUID_ALT');
      expect(assetLiquidityClass('ZEC-USDT')).toBe('LONG_TAIL');
    });
  });

  describe('Altcoin Core Triad Quorum & Decision', () => {
    it('normalizes expected analyst count to core triad (3) for Altcoins without onchain/social', () => {
      const analyses = createAnalyses();
      const fusionOutput = createFusionOutput(analyses);

      const altcoinInput: DecisionInput = {
        symbol: 'ZEC-USDT',
        fusionOutput,
        market: analyses.market,
        technical: analyses.technical,
        news: analyses.news,
      };

      const decision = decisionService.decide(altcoinInput);

      expect(decision.decision).toBe('LONG');
      // For Altcoin with 3 usable analysts (market, technical, news), evidence coverage is 100%
      expect(decision.evidenceCoverage).toBe(100);
      expect(decision.dataQuality).toBe('GOOD');
      expect(decision.coreDataQuality).toBe('GOOD');
    });

    it('approves an Altcoin in DecisionJudgeService with Core Triad even under strict execution mode', () => {
      const analyses = createAnalyses();
      const fusionOutput = createFusionOutput(analyses);

      const altcoinInput: DecisionInput = {
        symbol: 'ARB-USDT',
        fusionOutput,
        market: analyses.market,
        technical: analyses.technical,
        news: analyses.news,
      };

      const decision = decisionService.decide(altcoinInput);

      // In DEMO mode, uncalibrated Altcoin with Core Triad is APPROVED (with size factor for new cohort)
      const demoResult = judgeService.evaluate(decision, analyses, {
        symbol: 'ARB-USDT',
        mode: 'DEMO',
        requireCalibratedConfidence: true,
        timeframe: '15m',
      });

      expect(demoResult.verdict).toBe('APPROVE');
      expect(demoResult.approved).toBe(true);
      expect(demoResult.reasons).not.toContain('INSUFFICIENT_USABLE_ANALYSTS');
      expect(demoResult.reasons).not.toContain('PARTIAL_DATA_UNCALIBRATED');

      // In LIVE mode with exact calibration, Altcoin with Core Triad is APPROVED
      const calibratedDecision = {
        ...decision,
        confidenceCalibration: {
          status: 'CALIBRATED' as const,
          scope: 'EXACT' as const,
          rawScore: 80,
          empiricalProbability: 0.62,
          sampleSize: 60,
          bucketSampleSize: 60,
          brierScore: 0.18,
        },
      };
      const liveResult = judgeService.evaluate(calibratedDecision, analyses, {
        symbol: 'ARB-USDT',
        mode: 'LIVE',
        requireCalibratedConfidence: true,
        timeframe: '15m',
      });

      expect(liveResult.verdict).toBe('APPROVE');
      expect(liveResult.approved).toBe(true);
      expect(liveResult.reasons).not.toContain('INSUFFICIENT_USABLE_ANALYSTS');
      expect(liveResult.reasons).not.toContain('PARTIAL_DATA_UNCALIBRATED');
    });
  });

  describe('Price Run-up / Chase Protection (Anti-FOMO / Anti-Trap)', () => {
    it('forces WAIT and records override when high-impact positive news arrives after > 2 ATR price run-up', () => {
      const analyses = createAnalyses({
        market: {
          summary: 'Market in rapid pump.',
          trend: { direction: 'UP', strength: 'STRONG' },
          volatility: { level: 'HIGH', atr: '2.0' },
          liquidity: {},
          derivatives: {},
          anomalies: [],
          dataQuality: 'GOOD',
          usedTools: ['market.ticker.get'],
          generatedAt: new Date().toISOString(),
        },
        news: {
          summary: 'Breaking: Major partnership announced!',
          impact: { level: 'HIGH', direction: 'POSITIVE' },
          keyEvents: [],
          latestPublishedAt: null,
          themes: [],
          riskSignals: [],
          dataQuality: 'GOOD',
          usedTools: ['news.articles.list'],
          generatedAt: new Date().toISOString(),
        },
      });
      const fusionOutput = createFusionOutput(analyses);

      const input: DecisionInput = {
        symbol: 'SOL-USDT',
        fusionOutput,
        market: analyses.market,
        technical: analyses.technical,
        news: analyses.news,
      };

      // Reference price is 100, current price is 105 (> 100 + 2 * 2.0 = 104)
      const decision = decisionService.decide(input, {
        referencePrice: 100,
        currentPrice: 105,
      });

      expect(decision.decision).toBe('WAIT');
      expect(decision.overrides).toContain(
        'High-impact positive news arrived after major price run-up (> 2 ATR); trade delayed to avoid liquidity exit trap.',
      );
    });

    it('forces WAIT when market anomalies detect parabolic exhaustion even if price difference is moderate', () => {
      const analyses = createAnalyses({
        market: {
          summary: 'Market parabolic chase in progress.',
          trend: { direction: 'UP', strength: 'STRONG' },
          volatility: { level: 'HIGH', atr: '2.0' },
          liquidity: {},
          derivatives: {},
          anomalies: ['Parabolic chase detected near key resistance'],
          dataQuality: 'GOOD',
          usedTools: ['market.ticker.get'],
          generatedAt: new Date().toISOString(),
        },
        news: {
          summary: 'Bullish news announcement.',
          impact: { level: 'HIGH', direction: 'POSITIVE' },
          keyEvents: [],
          latestPublishedAt: null,
          themes: [],
          riskSignals: [],
          dataQuality: 'GOOD',
          usedTools: ['news.articles.list'],
          generatedAt: new Date().toISOString(),
        },
      });
      const fusionOutput = createFusionOutput(analyses);

      const input: DecisionInput = {
        symbol: 'SOL-USDT',
        fusionOutput,
        market: analyses.market,
        technical: analyses.technical,
        news: analyses.news,
      };

      const decision = decisionService.decide(input, {
        referencePrice: 100,
        currentPrice: 101, // Only 0.5 ATR increase
      });

      expect(decision.decision).toBe('WAIT');
      expect(decision.overrides).toContain(
        'High-impact positive news arrived after major price run-up (> 2 ATR); trade delayed to avoid liquidity exit trap.',
      );
    });

    it('allows LONG when high-impact positive news arrives with fresh/unextended price (<= 2 ATR)', () => {
      const analyses = createAnalyses({
        market: {
          summary: 'Market consolidating near breakout level.',
          trend: { direction: 'UP', strength: 'STRONG' },
          volatility: { level: 'MEDIUM', atr: '2.0' },
          liquidity: {},
          derivatives: {},
          anomalies: [],
          dataQuality: 'GOOD',
          usedTools: ['market.ticker.get'],
          generatedAt: new Date().toISOString(),
        },
        news: {
          summary: 'Fresh bullish protocol upgrade announcement.',
          impact: { level: 'HIGH', direction: 'POSITIVE' },
          keyEvents: [],
          latestPublishedAt: null,
          themes: [],
          riskSignals: [],
          dataQuality: 'GOOD',
          usedTools: ['news.articles.list'],
          generatedAt: new Date().toISOString(),
        },
      });
      const fusionOutput = createFusionOutput(analyses);

      const input: DecisionInput = {
        symbol: 'SOL-USDT',
        fusionOutput,
        market: analyses.market,
        technical: analyses.technical,
        news: analyses.news,
      };

      // Reference price is 100, current price is 101.5 (< 2 * 2.0 = 4 ATR buffer)
      const decision = decisionService.decide(input, {
        referencePrice: 100,
        currentPrice: 101.5,
      });

      expect(decision.decision).toBe('LONG');
      expect(decision.overrides).toContain(
        'High-impact positive news increased the bias toward LONG.',
      );
    });

    it('forces WAIT and records override when high-impact negative news arrives after major price dump (> 2 ATR)', () => {
      const analyses = createAnalyses({
        market: {
          summary: 'Market dumping hard.',
          trend: { direction: 'DOWN', strength: 'STRONG' },
          volatility: { level: 'HIGH', atr: '2.0' },
          liquidity: {},
          derivatives: {},
          anomalies: [],
          dataQuality: 'GOOD',
          usedTools: ['market.ticker.get'],
          generatedAt: new Date().toISOString(),
        },
        technical: {
          summary: 'Technical breakdown.',
          trend: { direction: 'DOWN', strength: 'STRONG' },
          momentum: { rsi: '30', rsiState: 'NEUTRAL', macd: { trend: 'BEARISH' } },
          movingAverages: { alignment: 'BEARISH', pricePosition: 'BELOW' },
          volatility: { bollinger: { position: 'MIDDLE', squeeze: false } },
          structure: { marketStructure: 'LH_LL' },
          divergence: {},
          signals: [],
          dataQuality: 'GOOD',
          usedTools: ['market.indicators.get'],
          generatedAt: new Date().toISOString(),
        },
        news: {
          summary: 'Breaking: Major regulatory lawsuit announced!',
          impact: { level: 'HIGH', direction: 'NEGATIVE' },
          keyEvents: [],
          latestPublishedAt: null,
          themes: [],
          riskSignals: [],
          dataQuality: 'GOOD',
          usedTools: ['news.articles.list'],
          generatedAt: new Date().toISOString(),
        },
      });
      const fusionOutput = createFusionOutput(analyses);

      const input: DecisionInput = {
        symbol: 'ETH-USDT',
        fusionOutput,
        market: analyses.market,
        technical: analyses.technical,
        news: analyses.news,
      };

      // Reference price is 100, current price is 94 (> 2 * 2.0 = 4 ATR dump)
      const decision = decisionService.decide(input, {
        referencePrice: 100,
        currentPrice: 94,
      });

      expect(decision.decision).toBe('WAIT');
      expect(decision.overrides).toContain(
        'High-impact negative news arrived after major price dump (> 2 ATR); trade delayed to avoid selling climax trap.',
      );
    });
  });
});
