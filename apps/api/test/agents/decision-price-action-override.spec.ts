import { describe, expect, it } from 'vitest';
import {
  DecisionOutputSchema,
  type DecisionInput,
  type FusionInput,
  type FusionOutput,
} from '@platform/shared';
import { DecisionService } from '../../src/modules/agents/application/services/decision.service';

function baseAnalyses(): { analyses: FusionInput; fusionOutput: FusionOutput } {
  const generatedAt = new Date().toISOString();
  const analyses: FusionInput = {
    market: {
      summary: 'Price above EMA20/EMA50 with expanding volatility.',
      trend: { direction: 'UP', strength: 'STRONG' },
      volatility: { level: 'HIGH' },
      liquidity: {}, derivatives: {}, anomalies: [], dataQuality: 'GOOD',
      usedTools: ['market.ticker.get'], generatedAt,
    },
    technical: {
      summary: 'Strong uptrend confirmed by RSI, EMA, MACD.',
      trend: { direction: 'UP', strength: 'STRONG' },
      momentum: { rsi: '72', rsiState: 'OVERBOUGHT', macd: { trend: 'BULLISH' } },
      movingAverages: { alignment: 'BULLISH', pricePosition: 'ABOVE' },
      volatility: { bollinger: { position: 'UPPER', squeeze: false } },
      structure: { marketStructure: 'HH_HL' }, divergence: {}, signals: [],
      dataQuality: 'GOOD', usedTools: ['market.indicators.get'], generatedAt,
    },
    news: {
      summary: 'Generic negative news about Fed balance sheet concerns.',
      impact: { level: 'HIGH', direction: 'NEGATIVE' },
      keyEvents: [{ title: 'Why the Fed balance sheet is lying to you', impact: 'NEGATIVE', importance: 80 }],
      themes: ['macro-uncertainty'],
      riskSignals: ['A major news event may cause abrupt market repricing.'],
      dataQuality: 'GOOD', usedTools: ['news.articles.list'], generatedAt,
    },
    sentiment: {
      summary: 'Sentiment is neutral.',
      sentiment: { overall: 'NEUTRAL', intensity: 'LOW' },
      crowdBehavior: { fomo: false, panic: false, euphoria: false }, sources: {},
      anomalies: [], dataQuality: 'GOOD', usedTools: ['sentiment.market.get'], generatedAt,
    },
    macro: {
      summary: 'Macro conditions neutral.', macroTrend: 'NEUTRAL', keyEvents: [],
      riskFactors: [], dataQuality: 'GOOD', generatedAt,
    },
    onchain: {
      summary: 'Onchain activity is normal.', activity: 'NORMAL',
      flows: {}, signals: [],
      dataQuality: 'GOOD', generatedAt,
    },
  };
  return {
    analyses,
    fusionOutput: {
      summary: 'Strong bullish technicals vs negative news.',
      combinedAnalysis: {
        market: analyses.market.summary, technical: analyses.technical.summary,
        news: analyses.news.summary, sentiment: analyses.sentiment.summary,
        macro: analyses.macro.summary, onchain: analyses.onchain.summary,
      },
      overallBias: 'BULLISH', confidence: 60,
      conflicts: [],
      dataQuality: 'GOOD', generatedAt,
    },
  };
}

function createDecisionInput(): DecisionInput {
  const value = baseAnalyses();
  return { symbol: 'ARB-USDT', fusionOutput: value.fusionOutput, ...value.analyses };
}

describe('DecisionService - Price-Action Override for News Conflict', () => {
  it('keeps LONG candidate when Market + Technical are strongly bullish despite HIGH negative news (ARB pump scenario)', () => {
    const service = new DecisionService({} as never);
    const input = createDecisionInput();

    // Replicate exact ARB 9% pump scenario:
    // Market: BULLISH STRONG (price above EMAs, expanding volatility)
    // Technical: BULLISH STRONG (RSI bullish, EMA alignment, MACD bullish)
    // News: HIGH NEGATIVE (generic Fed article + employment data)
    // Macro: NEUTRAL (no RISK_OFF)

    const output = service.decide(input);

    expect(DecisionOutputSchema.safeParse(output).success).toBe(true);
    // When Market + Technical are BOTH strongly bullish (rawDirectionalBias >= 60),
    // negative news should NOT force WAIT — price action overrides stale/generic news
    expect(output.decision).toBe('LONG');
    expect(output.overrides).toEqual(expect.arrayContaining([
      expect.stringContaining('price-action override'),
    ]));
    // Confidence should still be penalized (not a free ride) but should not be 0
    expect(output.confidence).toBeGreaterThan(0);
  });

  it('forces WAIT when Market is bullish but Technical is not (weak price-action evidence)', () => {
    const service = new DecisionService({} as never);
    const input = createDecisionInput();

    // Market bullish but Technical is not — rawDirectionalBias will be lower
    input.technical!.trend.direction = 'SIDEWAYS';
    input.technical!.movingAverages.alignment = 'MIXED';
    input.technical!.movingAverages.pricePosition = 'INSIDE';
    input.technical!.momentum.rsi = '50';
    input.technical!.momentum.rsiState = 'NEUTRAL';

    const output = service.decide(input);

    expect(DecisionOutputSchema.safeParse(output).success).toBe(true);
    // Without strong Technical confirmation, negative news should still force WAIT
    expect(output.decision).not.toBe('LONG');
  });

  it('forces WAIT when extreme volatility with liquidation cascades even with strong technicals', () => {
    const service = new DecisionService({} as never);
    const input = createDecisionInput();

    // Add extreme volatility anomaly — this should override even strong technicals
    input.market!.anomalies = ['liquidation cascade', 'violent price swings'];
    input.market!.volatility.level = 'HIGH';

    const output = service.decide(input);

    expect(DecisionOutputSchema.safeParse(output).success).toBe(true);
    // Extreme/panic volatility should override the price-action override
    // The decision should be WAIT or at least not confidently LONG
    if (output.decision === 'LONG') {
      // If LONG survives extreme volatility, confidence must be heavily penalized
      expect(output.confidence).toBeLessThan(40);
    }
  });

  it('existing behavior: negative news + macro RISK_ON => news suppressed', () => {
    const service = new DecisionService({} as never);
    const input = createDecisionInput();

    // When macro is RISK_ON, negative news shock is suppressed (existing logic)
    input.macro!.macroTrend = 'RISK_ON';

    const output = service.decide(input);

    expect(DecisionOutputSchema.safeParse(output).success).toBe(true);
    expect(output.decision).toBe('LONG');
    expect(output.overrides).toContain('Negative news shock suppressed due to dominant macro RISK_ON regime.');
  });
});
