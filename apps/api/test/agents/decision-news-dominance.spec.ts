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
      summary: 'Market is in neutral consolidation.',
      trend: { direction: 'SIDEWAYS', strength: 'MODERATE' },
      volatility: { level: 'MEDIUM' },
      liquidity: {}, derivatives: {}, anomalies: [], dataQuality: 'GOOD',
      usedTools: ['market.ticker.get'], generatedAt,
    },
    technical: {
      summary: '15m EMA20 is below EMA50, lagging indicators are bearish.',
      trend: { direction: 'DOWN', strength: 'MODERATE' },
      momentum: { rsi: '42', rsiState: 'NEUTRAL', macd: { trend: 'BEARISH' } },
      movingAverages: { alignment: 'BEARISH', pricePosition: 'BELOW' },
      volatility: { bollinger: { position: 'MIDDLE', squeeze: false } },
      structure: { marketStructure: 'RANGE' }, divergence: {}, signals: [],
      dataQuality: 'GOOD', usedTools: ['market.indicators.get'], generatedAt,
    },
    news: {
      summary: 'No breaking news.',
      impact: { level: 'LOW', direction: 'NEUTRAL' }, keyEvents: [], themes: [],
      riskSignals: [], dataQuality: 'GOOD', usedTools: ['news.articles.list'], generatedAt,
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
      summary: 'Mixed market signals.',
      combinedAnalysis: {
        market: analyses.market.summary, technical: analyses.technical.summary,
        news: analyses.news.summary, sentiment: analyses.sentiment.summary,
        macro: analyses.macro.summary, onchain: analyses.onchain.summary,
      },
      overallBias: 'NEUTRAL', confidence: 50,
      conflicts: [],
      dataQuality: 'GOOD', generatedAt,
    },
  };
}

function createDecisionInput(): DecisionInput {
  const value = baseAnalyses();
  return { symbol: 'ZEC-USDT', fusionOutput: value.fusionOutput, ...value.analyses };
}

describe('DecisionService - News Dominance & Macro Momentum Override', () => {
  it('overrides lagging bearish technical indicators toward LONG when Macro is RISK_ON (ZEC 19:31 scenario)', () => {
    const service = new DecisionService({} as never);
    const input = createDecisionInput();

    // Replicate ZEC 19:31 condition: Technical is lagging bearish
    input.technical!.trend.direction = 'DOWN';
    input.technical!.movingAverages.alignment = 'BEARISH';
    input.technical!.movingAverages.pricePosition = 'BELOW';
    input.market!.trend.direction = 'SIDEWAYS';

    // Fresh macro release: CPI came in cold / dovish -> RISK_ON
    input.macro!.macroTrend = 'RISK_ON';
    input.macro!.summary = 'US CPI came in at 2.5% vs 2.9% expected. Dovish signal for crypto.';

    const output = service.decide(input);

    expect(DecisionOutputSchema.safeParse(output).success).toBe(true);
    // Crucial: Must NEVER be SHORT. Macro momentum overrides lagging technicals.
    expect(output.decision).not.toBe('SHORT');
    expect(output.overrides.some((o) => o.includes('RISK_ON') || o.includes('macro-shock'))).toBe(true);
  });

  it('suppresses stale negative news shock when fresh Macro release is RISK_ON', () => {
    const service = new DecisionService({} as never);
    const input = createDecisionInput();

    // Replicate exact production bug: stale negative news existed from hours ago
    input.news!.impact = { level: 'HIGH', direction: 'NEGATIVE' };
    input.news!.summary = 'Generic old negative news headline.';

    // But fresh Macro CPI just dropped: RISK_ON!
    input.macro!.macroTrend = 'RISK_ON';
    input.macro!.summary = 'CPI lower than forecast, risk assets soaring.';

    const output = service.decide(input);

    // Negative news override should NOT turn candidate into SHORT
    expect(output.decision).not.toBe('SHORT');
    expect(output.overrides).toContain('Negative news shock suppressed due to dominant macro RISK_ON regime.');
  });

  it('symmetrically overrides lagging bullish technical indicators toward SHORT when Macro is RISK_OFF', () => {
    const service = new DecisionService({} as never);
    const input = createDecisionInput();

    // Technicals were previously bullish (lagging 15m EMAs above)
    input.technical!.trend.direction = 'UP';
    input.technical!.movingAverages.alignment = 'BULLISH';
    input.technical!.movingAverages.pricePosition = 'ABOVE';
    input.market!.trend.direction = 'SIDEWAYS';

    // Macro shock: Hot CPI / emergency rate hike -> RISK_OFF
    input.macro!.macroTrend = 'RISK_OFF';
    input.macro!.summary = 'CPI surged unexpectedly. Fed signals aggressive rate hike.';

    const output = service.decide(input);

    expect(DecisionOutputSchema.safeParse(output).success).toBe(true);
    expect(output.decision).not.toBe('LONG');
    expect(output.overrides.some((o) => o.includes('RISK_OFF') || o.includes('macro-shock'))).toBe(true);
  });

  it('suppresses stale positive news shock when dominant Macro release is RISK_OFF', () => {
    const service = new DecisionService({} as never);
    const input = createDecisionInput();

    // Stale positive news
    input.news!.impact = { level: 'HIGH', direction: 'POSITIVE' };
    input.news!.summary = 'Old partnership announcement.';

    // Fresh hawkish macro
    input.macro!.macroTrend = 'RISK_OFF';
    input.macro!.summary = 'FOMC announced 50bps surprise hike.';

    const output = service.decide(input);

    expect(output.decision).not.toBe('LONG');
    expect(output.overrides).toContain('Positive news shock suppressed due to dominant macro RISK_OFF regime.');
  });

  it('high-impact positive news directly triggers LONG candidate even if technicals are not yet bullish', () => {
    const service = new DecisionService({} as never);
    const input = createDecisionInput();

    // Technicals are neutral/lagging
    input.technical!.trend.direction = 'SIDEWAYS';
    input.market!.trend.direction = 'SIDEWAYS';

    // High impact breaking positive news (e.g. SEC ETF Approval)
    input.news!.impact = { level: 'HIGH', direction: 'POSITIVE' };
    input.news!.summary = 'SEC approves crypto spot ETF officially!';

    const output = service.decide(input, {
      newsProbeAuthority: {
        news: {
          importance: 90,
          confidence: 90,
          direction: 'POSITIVE',
          sourceIds: ['coindesk', 'reuters'],
          publishedAt: new Date().toISOString(),
        },
        causality: {
          priceChangePercent: 1.5,
          volumeRatio: 1.6,
          missingEvidence: ['LIQUIDATION_DATA_UNAVAILABLE'],
        },
      },
    });

    expect(output.decision).toBe('LONG');
    expect(output.overrides).toEqual(expect.arrayContaining([
      expect.stringContaining('High-impact positive news increased the bias toward LONG.'),
    ]));
    expect(output.reasoning).toContain('normalized bullish bias');
  });

  it('keeps a high-impact news shock at WAIT without independent corroboration', () => {
    const service = new DecisionService({} as never);
    const input = createDecisionInput();
    input.technical!.trend.direction = 'SIDEWAYS';
    input.market!.trend.direction = 'SIDEWAYS';
    input.news!.impact = { level: 'HIGH', direction: 'POSITIVE' };

    const output = service.decide(input, {
      newsProbeAuthority: {
        news: {
          importance: 90,
          confidence: 90,
          direction: 'POSITIVE',
          sourceIds: ['coindesk'],
          publishedAt: new Date().toISOString(),
        },
        causality: {
          priceChangePercent: 1.5,
          volumeRatio: 1.6,
          missingEvidence: ['LIQUIDATION_DATA_UNAVAILABLE'],
        },
      },
    });

    expect(output.decision).toBe('WAIT');
    expect(output.overrides).toContain('NEWS_CORROBORATION_INSUFFICIENT');
  });
});
