import { describe, expect, it } from 'vitest';
import {
  MarketAgentInputSchema,
  MarketAgentOutputSchema,
} from '@platform/shared';
import {
  MARKET_ANALYST_ALLOWED_TOOLS,
  MARKET_ANALYST_DEFINITION,
} from '../../src/modules/agents/domain/definitions/market-analyst.definition';
import { AgentContextSection, AgentMemoryMode, AgentType } from '../../src/modules/agents/domain/enums';
import { PromptRegistry } from '../../src/modules/ai/infrastructure/prompt/prompt-registry';

describe('Market Analyst Agent', () => {
  const validInput = {
    symbol: 'BTC-USDT',
    provider: 'BINANCE_FUTURES',
    interval: '1h',
  } as const;

  const validOutput = {
    summary: 'Price structure is rising with moderate volatility.',
    trend: { direction: 'UP', strength: 'MODERATE' },
    volatility: { level: 'MEDIUM', atr: '1320.75' },
    liquidity: { bidAskSpread: '0.50', depthImbalance: 'BALANCED' },
    derivatives: {
      fundingRate: '0.0001',
      fundingTrend: 'STABLE',
      openInterest: '45280.5',
      oiTrend: 'STABLE',
    },
    anomalies: [],
    dataQuality: 'GOOD',
    usedTools: [...MARKET_ANALYST_ALLOWED_TOOLS],
    generatedAt: new Date().toISOString(),
  } as const;

  it('validates supported input and applies a 100-candle default', () => {
    expect(MarketAgentInputSchema.parse(validInput)).toEqual({
      ...validInput,
      lookbackCandles: 100,
    });
  });

  it.each([
    { ...validInput, symbol: 'DOGE-USDT' },
    { ...validInput, provider: 'UNKNOWN' },
    { ...validInput, interval: '4h' },
    { ...validInput, lookbackCandles: 501 },
    { ...validInput, unexpected: true },
  ])('rejects unsupported or unsafe input: %j', (input) => {
    expect(MarketAgentInputSchema.safeParse(input).success).toBe(false);
  });

  it('strictly validates structured output', () => {
    expect(MarketAgentOutputSchema.parse(validOutput)).toEqual(validOutput);
    expect(
      MarketAgentOutputSchema.safeParse({ ...validOutput, signal: 'LONG' }).success,
    ).toBe(false);
    expect(
      MarketAgentOutputSchema.safeParse({
        ...validOutput,
        trend: { direction: 'BULLISH', strength: 'MODERATE' },
      }).success,
    ).toBe(false);
  });

  it('uses only the six approved read-only tools and no memory or user data', () => {
    expect(MARKET_ANALYST_DEFINITION.type).toBe(AgentType.MARKET_ANALYST);
    expect(MARKET_ANALYST_DEFINITION.allowedToolNames).toEqual([
      ...MARKET_ANALYST_ALLOWED_TOOLS,
    ]);
    expect(MARKET_ANALYST_DEFINITION.maxToolRounds).toBe(3);
    expect(MARKET_ANALYST_DEFINITION.maxToolCalls).toBe(6);
    expect(MARKET_ANALYST_DEFINITION.memoryPolicy.mode).toBe(AgentMemoryMode.NONE);
    expect(MARKET_ANALYST_DEFINITION.contextPolicy.includeUserSettings).toBe(false);
    expect(MARKET_ANALYST_DEFINITION.contextPolicy.includeMemory).toBe(false);
    expect(MARKET_ANALYST_DEFINITION.contextPolicy.allowedSections).not.toContain(
      AgentContextSection.NEWS,
    );
    expect(MARKET_ANALYST_DEFINITION.allowedToolNames).not.toContain(
      'exchange.order.create',
    );
  });

  it('builds one deterministic, duplicate-free tool round', () => {
    const calls = MARKET_ANALYST_DEFINITION.buildToolCalls?.(
      MarketAgentInputSchema.parse(validInput),
    );
    expect(calls?.map((call) => call.toolName)).toEqual([
      ...MARKET_ANALYST_ALLOWED_TOOLS,
    ]);
    expect(new Set(calls?.map((call) => call.toolName)).size).toBe(6);
    expect(calls?.[1]?.arguments).toMatchObject({ limit: 100, interval: '1h' });
  });

  it('registers the non-trading market_analyst_v1 prompt', () => {
    const prompt = new PromptRegistry().getVersion('market_analyst_v1', 1);
    expect(prompt?.userTemplate).toBe(
      'Analyze the current market conditions for {{symbol}} on {{interval}}',
    );
    expect(prompt?.systemTemplate).toContain('Never generate LONG or SHORT decisions');
    expect(prompt?.systemTemplate).toContain('Do not hallucinate missing data');
  });
});
