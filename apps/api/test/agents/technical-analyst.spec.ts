import { describe, expect, it } from 'vitest';
import {
  TechnicalAgentInputSchema,
  TechnicalAgentOutputSchema,
} from '@platform/shared';
import {
  mapMacdTrend,
  mapRsiState,
} from '../../src/modules/agents/domain/analysis/technical-indicator-mapper';
import {
  TECHNICAL_ANALYST_ALLOWED_TOOLS,
  TECHNICAL_ANALYST_DEFINITION,
} from '../../src/modules/agents/domain/definitions/technical-analyst.definition';
import {
  AgentContextSection,
  AgentType,
} from '../../src/modules/agents/domain/enums';
import { PromptRegistry } from '../../src/modules/ai/infrastructure/prompt/prompt-registry';

describe('Technical Analyst Agent', () => {
  const input = {
    symbol: 'BTC-USDT',
    provider: 'BINANCE_FUTURES',
    interval: '1h',
  } as const;

  const output = {
    summary:
      'Momentum is elevated while price retains a higher-high structure.',
    trend: { direction: 'UP', strength: 'MODERATE' },
    momentum: {
      rsi: '72.40',
      rsiState: 'OVERBOUGHT',
      macd: { trend: 'BULLISH', crossover: 'NONE' },
    },
    movingAverages: { alignment: 'BULLISH', pricePosition: 'ABOVE' },
    volatility: {
      atr: '1320.75',
      bollinger: { position: 'UPPER', squeeze: false },
    },
    structure: { marketStructure: 'HH_HL', breakout: false },
    divergence: { rsiDivergence: 'NONE', macdDivergence: 'NONE' },
    signals: ['RSI is above the overbought threshold.'],
    dataQuality: 'GOOD',
    usedTools: [...TECHNICAL_ANALYST_ALLOWED_TOOLS],
    generatedAt: new Date().toISOString(),
  } as const;

  it('maps RSI thresholds deterministically', () => {
    expect(mapRsiState(70.01)).toBe('OVERBOUGHT');
    expect(mapRsiState(70)).toBe('NEUTRAL');
    expect(mapRsiState(29.99)).toBe('OVERSOLD');
    expect(mapRsiState(30)).toBe('NEUTRAL');
  });

  it('maps MACD histogram direction deterministically', () => {
    expect(mapMacdTrend(0.2)).toBe('BULLISH');
    expect(mapMacdTrend(-0.2)).toBe('BEARISH');
    expect(mapMacdTrend(0)).toBe('NEUTRAL');
  });

  it('defaults to 150 candles and rejects unsafe input', () => {
    expect(TechnicalAgentInputSchema.parse(input)).toEqual({
      ...input,
      lookbackCandles: 150,
    });
    expect(
      TechnicalAgentInputSchema.safeParse({ ...input, lookbackCandles: 501 })
        .success,
    ).toBe(false);
    expect(
      TechnicalAgentInputSchema.safeParse({ ...input, symbol: '' })
        .success,
    ).toBe(false);
  });

  it('strictly validates structured, non-trading output', () => {
    expect(TechnicalAgentOutputSchema.parse(output)).toEqual(output);
    expect(
      TechnicalAgentOutputSchema.parse(
        Object.fromEntries(
          Object.entries(output).filter(([key]) => key !== 'divergence'),
        ),
      ),
    ).toEqual({
      ...output,
      divergence: {},
    });
    expect(
      TechnicalAgentOutputSchema.safeParse({ ...output, signal: 'LONG' })
        .success,
    ).toBe(false);
    expect(
      TechnicalAgentOutputSchema.safeParse({
        ...output,
        momentum: { ...output.momentum, rsiState: 'HIGH' },
      }).success,
    ).toBe(false);
  });

  it('uses only indicators and candles within two tool rounds', () => {
    expect(TECHNICAL_ANALYST_DEFINITION.type).toBe(AgentType.TECHNICAL_ANALYST);
    expect(TECHNICAL_ANALYST_DEFINITION.allowedToolNames).toEqual([
      'market.indicators.get',
      'market.candles.list',
    ]);
    expect(TECHNICAL_ANALYST_DEFINITION.maxToolRounds).toBe(2);
    expect(TECHNICAL_ANALYST_DEFINITION.maxToolCalls).toBe(2);
    expect(TECHNICAL_ANALYST_DEFINITION.contextPolicy.allowedSections).toEqual([
      AgentContextSection.MARKET_CANDLES,
      AgentContextSection.MARKET_INDICATORS,
    ]);
    expect(TECHNICAL_ANALYST_DEFINITION.allowedToolNames).not.toContain(
      'market.order_book.get',
    );
  });

  it('prefers indicators and avoids duplicate calls', () => {
    const calls = TECHNICAL_ANALYST_DEFINITION.buildToolCalls?.(
      TechnicalAgentInputSchema.parse(input),
    );
    expect(calls?.map((call) => call.toolName)).toEqual([
      'market.indicators.get',
      'market.candles.list',
    ]);
    expect(calls?.[1]?.arguments).toMatchObject({ limit: 150, interval: '1h' });
    expect(new Set(calls?.map((call) => call.toolName)).size).toBe(2);
  });

  it('registers the strict non-trading prompt', () => {
    const prompt = new PromptRegistry().getVersion('technical_analyst_v1', 1);
    expect(prompt?.userTemplate).toBe(
      'Analyze technical conditions for {{symbol}} on {{interval}}',
    );
    expect(prompt?.systemTemplate).toContain(
      'Never output LONG, SHORT, BUY, or SELL',
    );
    expect(prompt?.systemTemplate).toContain('Do not hallucinate missing data');
  });
});
