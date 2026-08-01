import { describe, expect, it, vi } from 'vitest';
import {
  FusionOutputSchema,
  MacroAgentInputSchema,
  MacroAgentOutputSchema,
  OnChainAgentOutputSchema,
  type FusionInput,
} from '@platform/shared';
import { FusionService } from '../../src/modules/agents/application/services/fusion.service';
import { MACRO_ANALYST_DEFINITION } from '../../src/modules/agents/domain/definitions/macro-analyst.definition';
import { ON_CHAIN_ANALYST_DEFINITION } from '../../src/modules/agents/domain/definitions/on-chain-analyst.definition';
import {
  AgentContextSection,
  AgentInvocationSource,
  AgentStatus,
  AgentType,
} from '../../src/modules/agents/domain/enums';
import { PromptRegistry } from '../../src/modules/ai/infrastructure/prompt/prompt-registry';

function analysisFixture(): FusionInput {
  const generatedAt = new Date().toISOString();
  return {
    market: {
      summary: 'Price structure is rising.',
      trend: { direction: 'UP', strength: 'MODERATE' },
      volatility: { level: 'MEDIUM' },
      liquidity: { depthImbalance: 'BALANCED' },
      derivatives: {},
      anomalies: [],
      dataQuality: 'GOOD',
      usedTools: ['market.ticker.get'],
      generatedAt,
    },
    technical: {
      summary: 'Momentum and structure are constructive.',
      trend: { direction: 'UP', strength: 'MODERATE' },
      momentum: {
        rsi: '58',
        rsiState: 'NEUTRAL',
        macd: { trend: 'BULLISH' },
      },
      movingAverages: { alignment: 'BULLISH', pricePosition: 'ABOVE' },
      volatility: { bollinger: { position: 'MIDDLE', squeeze: false } },
      structure: { marketStructure: 'HH_HL' },
      divergence: {},
      signals: ['Higher-high structure remains intact.'],
      dataQuality: 'GOOD',
      usedTools: ['market.indicators.get'],
      generatedAt,
    },
    news: {
      summary: 'Recent news impact is positive.',
      impact: { level: 'MEDIUM', direction: 'POSITIVE' },
      keyEvents: [],
      themes: ['institutional'],
      riskSignals: [],
      dataQuality: 'GOOD',
      usedTools: ['news.articles.list'],
      generatedAt,
    },
    sentiment: {
      summary: 'Crowd sentiment is optimistic.',
      sentiment: { overall: 'BULLISH', intensity: 'MEDIUM' },
      crowdBehavior: { fomo: false, panic: false, euphoria: false },
      sources: { marketSentimentIndex: '62' },
      anomalies: [],
      dataQuality: 'GOOD',
      usedTools: ['sentiment.market.get'],
      generatedAt,
    },
    macro: {
      summary: 'Restrictive policy remains a macro headwind.',
      macroTrend: 'RISK_OFF',
      keyEvents: ['Policy rate held unchanged.'],
      riskFactors: ['Liquidity remains restrictive.'],
      dataQuality: 'GOOD',
      generatedAt,
    },
    onchain: {
      summary: 'Exchange inflows are rising.',
      activity: 'HIGH',
      flows: { exchangeInflow: 'Inflow is rising' },
      signals: ['Distribution pressure is elevated.'],
      dataQuality: 'GOOD',
      generatedAt,
    },
  };
}

describe('Macro and On-chain Analyst Agents', () => {
  it('defines bounded inputs and strict outputs', () => {
    expect(MacroAgentInputSchema.parse({})).toEqual({ lookbackHours: 24 });
    expect(MacroAgentInputSchema.safeParse({ lookbackHours: 721 }).success).toBe(
      false,
    );
    expect(
      MacroAgentOutputSchema.safeParse(analysisFixture().macro).success,
    ).toBe(true);
    expect(
      OnChainAgentOutputSchema.safeParse(analysisFixture().onchain).success,
    ).toBe(true);
    expect(
      MacroAgentOutputSchema.safeParse({
        ...analysisFixture().macro,
        decision: 'LONG',
      }).success,
    ).toBe(false);
  });

  it('restricts macro execution to its event tool', () => {
    expect(MACRO_ANALYST_DEFINITION.type).toBe(AgentType.MACRO_ANALYST);
    expect(MACRO_ANALYST_DEFINITION.allowedToolNames).toEqual([
      'macro.events.list',
    ]);
    expect(MACRO_ANALYST_DEFINITION.requiredCapabilities).toEqual([
      'READ_MACRO',
    ]);
    expect(MACRO_ANALYST_DEFINITION.contextPolicy.allowedSections).toEqual([
      AgentContextSection.MACRO,
    ]);
    expect(MACRO_ANALYST_DEFINITION.buildToolCalls?.({ lookbackHours: 48 })).toEqual(
      [
        {
          toolName: 'macro.events.list',
          arguments: { lookbackHours: 48, limit: 50 },
        },
      ],
    );
  });

  it('keeps the on-chain framework explicit about unavailable real data', () => {
    expect(ON_CHAIN_ANALYST_DEFINITION.type).toBe(AgentType.ON_CHAIN_ANALYST);
    expect(ON_CHAIN_ANALYST_DEFINITION.status).toBe(AgentStatus.ACTIVE);
    expect(ON_CHAIN_ANALYST_DEFINITION.allowedToolNames).toEqual([]);
    expect(ON_CHAIN_ANALYST_DEFINITION.requiredCapabilities).toEqual([]);
    const fallback = ON_CHAIN_ANALYST_DEFINITION.buildInsufficientOutput?.(
      [],
      'provider unavailable',
    );
    expect(OnChainAgentOutputSchema.safeParse(fallback).success).toBe(true);
    expect(fallback?.dataQuality).toBe('INSUFFICIENT');
  });

  it('registers non-trading macro and on-chain prompts', () => {
    const registry = new PromptRegistry();
    const macro = registry.getVersion('macro_analyst_v1', 1);
    const onchain = registry.getVersion('on_chain_analyst_v1', 1);
    expect(macro?.systemTemplate).toContain(
      'Never output LONG, SHORT, BUY, or SELL',
    );
    expect(onchain?.systemTemplate).toContain(
      'no connected on-chain data provider',
    );
  });
});

describe('FusionService', () => {
  it('uses majority bias, agreement confidence, conflict logs, and quality', () => {
    const fusion = new FusionService({} as never);
    const output = fusion.fuse(analysisFixture());

    expect(FusionOutputSchema.safeParse(output).success).toBe(true);
    expect(output.overallBias).toBe('BULLISH');
    expect(output.confidence).toBe(67);
    expect(output.dataQuality).toBe('GOOD');
    expect(output.conflicts).toEqual(
      expect.arrayContaining([
        expect.stringContaining('bullish'),
        expect.stringContaining('bearish'),
      ]),
    );
    expect(output.combinedAnalysis.macro).toBe(
      analysisFixture().macro.summary,
    );
  });

  it('returns neutral when directional agents are evenly mixed', () => {
    const input = analysisFixture();
    input.news.impact.direction = 'NEGATIVE';
    const output = new FusionService({} as never).fuse(input);

    expect(output.overallBias).toBe('NEUTRAL');
    expect(output.confidence).toBe(50);
  });

  it('runs all six agents through AgentExecutionService and validates output', async () => {
    const fixture = analysisFixture();
    const outputByType: Partial<Record<AgentType, unknown>> = {
      [AgentType.MARKET_ANALYST]: fixture.market,
      [AgentType.TECHNICAL_ANALYST]: fixture.technical,
      [AgentType.NEWS_ANALYST]: fixture.news,
      [AgentType.SENTIMENT_ANALYST]: fixture.sentiment,
      [AgentType.MACRO_ANALYST]: fixture.macro,
      [AgentType.ON_CHAIN_ANALYST]: fixture.onchain,
    };
    const executeSync = vi.fn().mockImplementation(
      ({ agentType }: { agentType: AgentType }) =>
        Promise.resolve({ output: outputByType[agentType] }),
    );
    const service = new FusionService({ executeSync } as never);

    const output = await service.run({
      input: {
        symbol: 'BTC-USDT',
        provider: 'BINANCE_FUTURES',
        interval: '15m',
        lookbackCandles: 150,
        lookbackHours: 6,
        maxItems: 20,
      },
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
    });

    expect(executeSync).toHaveBeenCalledTimes(6);
    const calledTypes = (
      executeSync.mock.calls as Array<[{ agentType: AgentType }]>
    ).map(([call]) => call.agentType);
    expect(calledTypes).toEqual(
      expect.arrayContaining([
        AgentType.MARKET_ANALYST,
        AgentType.TECHNICAL_ANALYST,
        AgentType.NEWS_ANALYST,
        AgentType.SENTIMENT_ANALYST,
        AgentType.MACRO_ANALYST,
        AgentType.ON_CHAIN_ANALYST,
      ]),
    );
    expect(FusionOutputSchema.safeParse(output).success).toBe(true);
  });

  it('degrades failed agent runs instead of failing the fusion response', async () => {
    const service = new FusionService({
      executeSync: vi.fn().mockRejectedValue(new Error('unavailable')),
    } as never);
    const output = await service.run({
      input: {
        symbol: 'ETH-USDT',
        provider: 'OKX_FUTURES',
        interval: '1h',
        lookbackCandles: 100,
        lookbackHours: 6,
        maxItems: 10,
      },
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
    });

    expect(output.overallBias).toBe('NEUTRAL');
    expect(output.confidence).toBe(0);
    expect(output.dataQuality).toBe('INSUFFICIENT');
    expect(FusionOutputSchema.safeParse(output).success).toBe(true);
  });
});
