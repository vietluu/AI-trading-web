import { describe, expect, it } from 'vitest';
import { UnifiedAnalystService } from '../../src/modules/agents/application/services/unified-analyst.service';
import { AgentInvocationSource } from '../../src/modules/agents/domain/enums';
import { ExchangeInterval, ExchangeProvider } from '../../src/exchange/domain/exchange.types';
import type { AgentExecutionService } from '../../src/modules/agents/application/services/agent-execution.service';

describe('UnifiedAnalystService safety fallback', () => {
  it('marks invalid agent outputs insufficient instead of fabricating a bullish market', async () => {
    const mockAgentExecutionService = {
      executeSync: () => Promise.resolve({ output: {} }),
    } as unknown as AgentExecutionService;

    const service = new UnifiedAnalystService(mockAgentExecutionService);
    const result = await service.analyze({
      input: {
        symbol: 'SOL-USDT',
        provider: ExchangeProvider.OKX_FUTURES,
        interval: ExchangeInterval.FIFTEEN_MINUTES,
        lookbackCandles: 200,
        lookbackHours: 24,
        maxItems: 50,
      },
      invocationSource: AgentInvocationSource.FUTURE_SCHEDULED,
    });

    expect(result.analyses).toBeDefined();
    expect(result.analyses.technical.trend.direction).toBe('SIDEWAYS');
    expect(result.analyses.market.dataQuality).toBe('INSUFFICIENT');
    expect(result.analyses.macro.macroTrend).toBe('NEUTRAL');
    expect(result.fusionOutput.overallBias).toBe('NEUTRAL');
    expect(result.fusionOutput.confidence).toBe(0);
    expect(result.fusionOutput.dataQuality).toBe('INSUFFICIENT');
  });

  it('safely falls back to neutral INSUFFICIENT outputs when agent execution throws an error', async () => {
    const mockAgentExecutionService = {
      executeSync: () => Promise.reject(new Error('AI_CIRCUIT_BREAKER_OPEN: provider quota exhausted')),
    } as unknown as AgentExecutionService;

    const service = new UnifiedAnalystService(mockAgentExecutionService);
    const result = await service.analyze({
      input: {
        symbol: 'BTC-USDT',
        provider: ExchangeProvider.BINANCE_FUTURES,
        interval: ExchangeInterval.FIVE_MINUTES,
        lookbackCandles: 100,
        lookbackHours: 12,
        maxItems: 20,
      },
      invocationSource: AgentInvocationSource.USER_MANUAL,
    });

    expect(result.analyses).toBeDefined();
    expect(result.analyses.market.dataQuality).toBe('INSUFFICIENT');
    expect(result.analyses.technical.dataQuality).toBe('INSUFFICIENT');
    expect(result.analyses.news.dataQuality).toBe('INSUFFICIENT');
    expect(result.analyses.sentiment.dataQuality).toBe('INSUFFICIENT');
    expect(result.analyses.macro.dataQuality).toBe('INSUFFICIENT');
    expect(result.analyses.onchain.dataQuality).toBe('INSUFFICIENT');
    expect(result.fusionOutput.overallBias).toBe('NEUTRAL');
    expect(result.fusionOutput.dataQuality).toBe('INSUFFICIENT');
  });
});
