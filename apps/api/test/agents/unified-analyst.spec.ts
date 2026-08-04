import { describe, expect, it } from 'vitest';
import { UnifiedAnalystService } from '../../src/modules/agents/application/services/unified-analyst.service';
import { AgentInvocationSource } from '../../src/modules/agents/domain/enums';
import { ExchangeInterval, ExchangeProvider } from '../../src/exchange/domain/exchange.types';
import type { AgentExecutionService } from '../../src/modules/agents/application/services/agent-execution.service';

describe('UnifiedAnalystService (1-Prompt Multi-Analyst Consolidation)', () => {
  it('consolidates 5 separate agent prompt requests into a single unified analysis', async () => {
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
    expect(result.analyses.technical.trend.direction).toBe('UP');
    expect(result.analyses.market.dataQuality).toBe('GOOD');
    expect(result.analyses.macro.macroTrend).toBe('RISK_ON');
    expect(result.fusionOutput.overallBias).toBe('BULLISH');
    expect(result.fusionOutput.confidence).toBeGreaterThanOrEqual(70);
  });
});
