import { describe, expect, it, vi } from 'vitest';
import {
  DecisionOutputSchema,
  type DecisionInput,
  type FusionInput,
  type FusionOutput,
} from '@platform/shared';
import { DecisionService } from '../../src/modules/agents/application/services/decision.service';
import { FusionService } from '../../src/modules/agents/application/services/fusion.service';
import { DECISION_SYNTHESIZER_DEFINITION } from '../../src/modules/agents/domain/definitions/decision-synthesizer.definition';
import { AgentInvocationSource, AgentType } from '../../src/modules/agents/domain/enums';
import { PromptRegistry } from '../../src/modules/ai/infrastructure/prompt/prompt-registry';

function fixture(): { analyses: FusionInput; fusionOutput: FusionOutput } {
  const generatedAt = new Date().toISOString();
  const analyses: FusionInput = {
    market: {
      summary: 'Market trend is rising.',
      trend: { direction: 'UP', strength: 'STRONG' },
      volatility: { level: 'MEDIUM' },
      liquidity: {}, derivatives: {}, anomalies: [], dataQuality: 'GOOD',
      usedTools: ['market.ticker.get'], generatedAt,
    },
    technical: {
      summary: 'Technical structure is bullish.',
      trend: { direction: 'UP', strength: 'STRONG' },
      momentum: { rsi: '58', rsiState: 'NEUTRAL', macd: { trend: 'BULLISH' } },
      movingAverages: { alignment: 'BULLISH', pricePosition: 'ABOVE' },
      volatility: { bollinger: { position: 'MIDDLE', squeeze: false } },
      structure: { marketStructure: 'HH_HL' }, divergence: {}, signals: [],
      dataQuality: 'GOOD', usedTools: ['market.indicators.get'], generatedAt,
    },
    news: {
      summary: 'News flow is constructive.',
      impact: { level: 'MEDIUM', direction: 'POSITIVE' }, keyEvents: [], themes: [],
      riskSignals: [], dataQuality: 'GOOD', usedTools: ['news.articles.list'], generatedAt,
    },
    sentiment: {
      summary: 'Sentiment is bullish.',
      sentiment: { overall: 'BULLISH', intensity: 'MEDIUM' },
      crowdBehavior: { fomo: false, panic: false, euphoria: false }, sources: {},
      anomalies: [], dataQuality: 'GOOD', usedTools: ['sentiment.market.get'], generatedAt,
    },
    macro: {
      summary: 'Macro conditions are supportive.', macroTrend: 'RISK_ON', keyEvents: [],
      riskFactors: ['Policy uncertainty remains elevated.'], dataQuality: 'GOOD', generatedAt,
    },
    onchain: {
      summary: 'Exchange inflows are rising.', activity: 'HIGH',
      flows: { exchangeInflow: 'Inflow is rising' }, signals: ['Distribution is elevated.'],
      dataQuality: 'GOOD', generatedAt,
    },
  };
  return {
    analyses,
    fusionOutput: {
      summary: 'Strong bullish majority with an on-chain conflict.',
      combinedAnalysis: {
        market: analyses.market.summary, technical: analyses.technical.summary,
        news: analyses.news.summary, sentiment: analyses.sentiment.summary,
        macro: analyses.macro.summary, onchain: analyses.onchain.summary,
      },
      overallBias: 'BULLISH', confidence: 67,
      conflicts: ['onchain indicates bearish conditions.'],
      dataQuality: 'GOOD', generatedAt,
    },
  };
}

function decisionInput(): DecisionInput {
  const value = fixture();
  return { symbol: 'BTC-USDT', fusionOutput: value.fusionOutput, ...value.analyses };
}

describe('DecisionService', () => {
  it('selects a performance horizon that matches the strategy holding period', () => {
    const service = new DecisionService({} as never) as unknown as {
      calibrationHorizon(strategyKey?: string, timeframe?: string): string;
    };
    expect(service.calibrationHorizon('momentum-scalp', '15m')).toBe('M30');
    expect(service.calibrationHorizon('trend', '15m')).toBe('H2');
    expect(service.calibrationHorizon('breakout', '15m')).toBe('MID');
  });

  it('keeps fallback calibration as telemetry without changing execution economics', async () => {
    const service = new DecisionService({} as never);
    const base = service.decide(decisionInput());
    const calibrationService = service as unknown as {
      confidenceCalibration: (...args: unknown[]) => Promise<{
        status: 'CALIBRATED' | 'INSUFFICIENT_HISTORY';
        rawScore: number;
        empiricalProbability: number | null;
        sampleSize: number;
        bucketSampleSize: number;
        brierScore: number | null;
        scope: 'EXACT' | 'STRATEGY_CONTEXT' | 'STRATEGY_TIMEFRAME' | 'USER_GLOBAL' | 'NONE';
        fallbackUsed: boolean;
      }>;
    };
    vi.spyOn(calibrationService, 'confidenceCalibration').mockResolvedValue({
      status: 'CALIBRATED', rawScore: base.confidence,
      empiricalProbability: 0.2, sampleSize: 500, bucketSampleSize: 100,
      brierScore: 0.4, scope: 'USER_GLOBAL', fallbackUsed: true,
    } as never);

    const output = await service.calibrateForExecution(base, 'user-1', {
      symbol: 'BTC-USDT', strategyKey: 'trend', provider: 'OKX_FUTURES', timeframe: '15m',
    });

    expect(output.confidenceCalibration?.scope).toBe('USER_GLOBAL');
    expect(output.expectedWinProbability).toBe(0.5);
  });

  it('detects a trending regime and increases technical weight', () => {
    const output = new DecisionService({} as never).decide(decisionInput());

    expect(DecisionOutputSchema.safeParse(output).success).toBe(true);
    expect(output.decision).toBe('LONG');
    expect(output.regime.type).toBe('TRENDING');
    expect(output.weighting.technical).toBe(30);
    expect(output.weighting.news).toBe(10);
    expect(Object.values(output.weighting).reduce((sum, weight) => sum + weight, 0)).toBe(100);
    expect(output.agreementScore).toBe(83);
    expect(output.confidence).toBeGreaterThanOrEqual(60);
    expect(output.opportunityScore).toBeGreaterThan(50);
    expect(output.expectedValue).toBeDefined();
    expect(output.adaptiveThreshold).toBeGreaterThan(0);
    expect(output.signals.bullishFactors).toEqual(expect.arrayContaining([
      expect.stringContaining('Market (20%)'),
      expect.stringContaining('Technical (30%)'),
    ]));
    expect(output.risks).toContain('Policy uncertainty remains elevated.');
  });

  it('forces WAIT when confidence is below 60 due to mixed signals', () => {
    const input = decisionInput();
    input.sentiment!.sentiment.overall = 'BEARISH';
    input.news!.impact.direction = 'NEGATIVE';
    const output = new DecisionService({} as never).decide(input);

    expect(output.decision).toBe('WAIT');
    expect(output.confidence).toBeLessThan(60);
    expect(output.conflictLevel).toBe('HIGH');
    expect(output.risks.some((risk) => risk.toLowerCase().includes('conflict'))).toBe(true);
  });

  it('retains a meaningful composite score for a well-supported WAIT decision', () => {
    const input = decisionInput();
    input.market!.trend.direction = 'SIDEWAYS';
    input.technical!.trend.direction = 'SIDEWAYS';
    input.news!.impact.direction = 'NEUTRAL';
    input.sentiment!.sentiment.overall = 'NEUTRAL';
    input.macro!.macroTrend = 'NEUTRAL';
    input.onchain!.activity = 'NORMAL';
    input.onchain!.flows = {};
    input.onchain!.signals = ['On-chain activity is neutral.'];
    input.fusionOutput.overallBias = 'NEUTRAL';
    input.fusionOutput.conflicts = [];
    const output = new DecisionService({} as never).decide(input);

    expect(output.decision).toBe('WAIT');
    expect(output.confidence).toBeGreaterThan(0);
    expect(output.confidenceKind).toBe('COMPOSITE_SCORE');
  });

  it('forces WAIT for insufficient active data', () => {
    const input = decisionInput();
    input.fusionOutput.dataQuality = 'INSUFFICIENT';
    for (const name of ['market', 'technical', 'news', 'sentiment'] as const) {
      input[name]!.dataQuality = 'INSUFFICIENT';
    }
    const output = new DecisionService({} as never).decide(input);

    expect(output.decision).toBe('WAIT');
    expect(output.confidence).toBeLessThan(60);
    expect(output.dataQuality).toBe('INSUFFICIENT');
    expect(output.overrides).toContain('Insufficient data forced WAIT.');
  });

  it('caps composite confidence when decision data is only partial', () => {
    const input = decisionInput();
    input.fusionOutput.dataQuality = 'PARTIAL';
    input.news!.dataQuality = 'PARTIAL';
    const output = new DecisionService({} as never).decide(input);

    expect(output.dataQuality).toBe('PARTIAL');
    expect(output.confidence).toBeLessThanOrEqual(75);
    expect(output.expectedWinProbability).toBe(0.5);
  });

  it('separates neutral auxiliary coverage from directional disagreement', () => {
    const input = decisionInput();
    input.fusionOutput.dataQuality = 'PARTIAL';
    input.news!.impact = { level: 'MEDIUM', direction: 'NEUTRAL' };
    input.news!.dataQuality = 'PARTIAL';
    input.sentiment!.sentiment.overall = 'NEUTRAL';
    input.sentiment!.dataQuality = 'PARTIAL';
    input.macro!.macroTrend = 'NEUTRAL';
    input.onchain!.dataQuality = 'INSUFFICIENT';
    input.onchain!.signals = ['Coin Metrics returned no verified coverage for this asset.'];
    const output = new DecisionService({} as never).decide(input);

    // The adaptive confidence threshold can still keep this synthetic setup at
    // WAIT. This regression checks that neutral auxiliary agents no longer
    // count as directional disagreement against the aligned core agents.
    expect(output.decision).toBe('WAIT');
    expect(output.dataQuality).toBe('PARTIAL');
    expect(output.coreDataQuality).toBe('GOOD');
    expect(output.agreementScore).toBe(40);
    expect(output.directionalAgreement).toBe(100);
    expect(output.evidenceCoverage).toBe(100);
  });

  it('does not let strong conviction bypass a high-volatility guardrail', () => {
    const input = decisionInput();
    input.market!.volatility.level = 'HIGH';
    input.market!.trend.direction = 'UP';
    input.market!.trend.strength = 'STRONG';
    input.technical!.trend.direction = 'UP';
    input.technical!.trend.strength = 'STRONG';
    input.sentiment!.sentiment.overall = 'BULLISH';
    input.macro!.macroTrend = 'RISK_ON';
    input.news!.impact.level = 'MEDIUM';
    input.news!.impact.direction = 'POSITIVE';
    input.market!.anomalies = ['Moderate volatility expansion.'];
    const output = new DecisionService({} as never).decide(input);

    expect(output.decision).toBe('WAIT');
    expect(output.confidence).toBeGreaterThanOrEqual(50);
    expect(output.opportunityScore).toBeGreaterThan(65);
    expect(output.overrides).not.toEqual(expect.arrayContaining([expect.stringContaining('Strong conviction override')]));
  });

  it('reduces confidence in high volatility and detects major news events', () => {
    const input = decisionInput();
    const baseline = new DecisionService({} as never).decide(input);
    input.market!.volatility.level = 'HIGH';
    input.news!.impact.level = 'HIGH';
    const output = new DecisionService({} as never).decide(input);

    expect(output.regime.type).toBe('HIGH_VOLATILITY');
    expect(output.volatilityAdjustment).toBe(-20);
    expect(output.confidence).toBeLessThan(baseline.confidence);
    expect(output.risks).toEqual(expect.arrayContaining([
      'High market volatility is present.',
      'A major news event may cause abrupt market repricing.',
    ]));
  });

  it('uses a high-impact negative news override when bearish evidence supports SHORT', () => {
    const input = decisionInput();
    input.market!.trend.direction = 'DOWN';
    input.technical!.trend.direction = 'DOWN';
    input.news!.impact = { level: 'HIGH', direction: 'NEGATIVE' };
    input.sentiment!.sentiment.overall = 'BEARISH';
    input.macro!.macroTrend = 'RISK_OFF';
    const output = new DecisionService({} as never).decide(input);

    expect(output.decision).toBe('SHORT');
    expect(output.overrides).toEqual(expect.arrayContaining([
      expect.stringContaining('negative news'),
      expect.stringContaining('toward SHORT'),
    ]));
  });

  it('forces WAIT when extreme volatility is detected', () => {
    const input = decisionInput();
    input.market!.volatility.level = 'HIGH';
    input.market!.anomalies = ['Extreme liquidation cascade detected.'];
    const output = new DecisionService({} as never).decide(input);

    expect(output.decision).toBe('WAIT');
    expect(output.volatilityAdjustment).toBe(-30);
    expect(output.overrides).toContain('Extreme volatility forced WAIT.');
  });

  it('detects a ranging regime and shifts weight from market to technical', () => {
    const input = decisionInput();
    input.market!.volatility.level = 'LOW';
    const output = new DecisionService({} as never).decide(input);

    expect(output.regime.type).toBe('RANGING');
    expect(output.weighting.market).toBe(15);
    expect(output.weighting.technical).toBe(30);
    expect(Object.values(output.weighting).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  it('adjusts the ranging threshold by spread width instead of spread presence', () => {
    const narrowInput = decisionInput();
    narrowInput.market!.volatility.level = 'LOW';
    narrowInput.market!.liquidity.bidAskSpread = '0.01%';
    const wideInput = decisionInput();
    wideInput.market!.volatility.level = 'LOW';
    wideInput.market!.liquidity.bidAskSpread = '0.12%';

    const narrow = new DecisionService({} as never).decide(narrowInput);
    const wide = new DecisionService({} as never).decide(wideInput);

    expect(wide.adaptiveThreshold).toBe(narrow.adaptiveThreshold + 7);
    expect(wide.executionCost).toBeGreaterThan(narrow.executionCost);
  });

  it('runs fusion analysis and decision as one pipeline', async () => {
    const detailed = fixture();
    const outputs: Partial<Record<AgentType, unknown>> = {
      [AgentType.MARKET_ANALYST]: detailed.analyses.market,
      [AgentType.TECHNICAL_ANALYST]: detailed.analyses.technical,
      [AgentType.NEWS_ANALYST]: detailed.analyses.news,
      [AgentType.SENTIMENT_ANALYST]: detailed.analyses.sentiment,
      [AgentType.MACRO_ANALYST]: detailed.analyses.macro,
      [AgentType.ON_CHAIN_ANALYST]: detailed.analyses.onchain,
    };
    const executeSync = vi.fn().mockImplementation(
      ({ agentType }: { agentType: AgentType }) => Promise.resolve({ output: outputs[agentType] }),
    );
    const service = new DecisionService(new FusionService({ executeSync } as never));
    const output = await service.run({
      input: {
        symbol: 'BTC-USDT', provider: 'BINANCE_FUTURES', interval: '15m',
        lookbackCandles: 150, lookbackHours: 6, maxItems: 20,
      },
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
    });

    expect(executeSync).toHaveBeenCalledTimes(6);
    expect(output.decision).toBe('LONG');
    expect(DecisionOutputSchema.safeParse(output).success).toBe(true);
  });

  it('registers a bounded, non-executing decision agent prompt', () => {
    expect(DECISION_SYNTHESIZER_DEFINITION.type).toBe(AgentType.DECISION_SYNTHESIZER);
    expect(DECISION_SYNTHESIZER_DEFINITION.allowedToolNames).toEqual([]);
    const prompt = new PromptRegistry().getVersion('decision_synthesizer_v1', 1);
    expect(prompt?.systemTemplate).toContain('confidence is below 60');
    expect(prompt?.systemTemplate).toContain('Never place or propose an order');
  });
});
