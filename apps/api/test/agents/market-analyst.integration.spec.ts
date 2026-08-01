import { describe, expect, it, vi } from 'vitest';
import { MarketAgentOutputSchema } from '@platform/shared';
import { AgentOutputValidatorService } from '../../src/modules/agents/application/services/agent-output-validator.service';
import { AgentRunnerService } from '../../src/modules/agents/application/runners/agent-runner.service';
import { MARKET_ANALYST_DEFINITION, MARKET_ANALYST_ALLOWED_TOOLS } from '../../src/modules/agents/domain/definitions/market-analyst.definition';
import { AgentInvocationSource, AgentRunState } from '../../src/modules/agents/domain/enums';

describe('Market Analyst Agent runner integration', () => {
  it('runs the BTC-USDT tool plan and persists schema-valid structured output', async () => {
    const output = {
      summary: 'BTC-USDT has an upward structure with moderate volatility and balanced depth.',
      trend: { direction: 'UP', strength: 'MODERATE' },
      volatility: { level: 'MEDIUM', atr: '1320.75' },
      liquidity: { bidAskSpread: '0.50', depthImbalance: 'BALANCED' },
      derivatives: {
        fundingRate: '0.0001',
        fundingTrend: 'STABLE',
        openInterest: '45280.5',
        oiTrend: 'INCREASING',
      },
      anomalies: [],
      dataQuality: 'GOOD',
      usedTools: [...MARKET_ANALYST_ALLOWED_TOOLS],
      generatedAt: new Date().toISOString(),
    };

    let run = {
      id: '00000000-0000-4000-8000-000000000001',
      status: AgentRunState.CREATED,
      traceId: 'trace-1',
      output: null,
      toolCallCount: 0,
      toolRoundCount: 0,
    };
    const repository = {
      createRun: vi.fn().mockResolvedValue(run),
      updateRun: vi.fn().mockImplementation((_id: string, update: Record<string, unknown>) => {
        run = { ...run, ...update };
        return Promise.resolve(run);
      }),
      addTransition: vi.fn().mockResolvedValue({}),
      saveOutput: vi.fn().mockResolvedValue({}),
    };
    const toolLoop = {
      runStep: vi.fn().mockImplementation((calls: Array<{ toolName: string }>) => Promise.resolve({
        shouldContinue: true,
        toolResults: calls.map((call, index) => ({
          providerCallId: `planned-${index + 1}`,
          toolName: call.toolName,
          result: {
            invocationId: `inv-${index + 1}`,
            toolName: call.toolName,
            toolVersion: 1,
            status: 'SUCCESS',
            data: { symbol: 'BTC-USDT', value: String(index + 1) },
            metadata: {
              startedAt: new Date(),
              completedAt: new Date(),
              durationMs: 1,
              cached: false,
              stale: false,
              schemaVersion: 1,
            },
          },
        })),
      })),
    };
    const orchestrator = {
      execute: vi.fn().mockResolvedValue({
        text: JSON.stringify(output),
        json: output,
        usage: { promptTokens: 100, completionTokens: 50, estimatedCost: 0, totalTokens: 150 },
        provider: 'OPENAI',
        model: 'test-model',
      }),
    };

    const runner = new AgentRunnerService(
      orchestrator as never,
      repository as never,
      { buildAndPersistSnapshot: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-1', contextString: '{}', tokenEstimate: 1 }) } as never,
      { resolve: vi.fn().mockReturnValue({ renderedPrompt: { systemPrompt: 'system', userPrompt: 'user' } }) } as never,
      { resolveTools: vi.fn().mockReturnValue({ toolCount: 6, providerSchemas: [], resolvedToolNames: [...MARKET_ANALYST_ALLOWED_TOOLS] }) } as never,
      { loadMemory: vi.fn(), persistOutput: vi.fn() } as never,
      new AgentOutputValidatorService(),
      {} as never,
      { acquireGlobal: vi.fn().mockResolvedValue({ acquired: true }), acquireUser: vi.fn().mockResolvedValue({ acquired: true }), acquireType: vi.fn().mockResolvedValue({ acquired: true }), releaseGlobal: vi.fn(), releaseUser: vi.fn(), releaseType: vi.fn() } as never,
      { checkAndLock: vi.fn().mockResolvedValue({ locked: true }), unlock: vi.fn(), setResult: vi.fn() } as never,
      { recordRun: vi.fn() } as never,
      toolLoop as never,
    );

    const result = await runner.run({
      definition: MARKET_ANALYST_DEFINITION,
      userId: '00000000-0000-4000-8000-000000000002',
      input: {
        symbol: 'BTC-USDT',
        provider: 'BINANCE_FUTURES',
        interval: '1h',
        lookbackCandles: 100,
      },
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
      correlationId: 'correlation-1',
    });

    expect(result.status).toBe(AgentRunState.COMPLETED);
    expect(toolLoop.runStep).toHaveBeenCalledOnce();
    expect(toolLoop.runStep.mock.calls[0]?.[0]).toHaveLength(6);
    expect(orchestrator.execute).toHaveBeenCalledWith(expect.objectContaining({ responseFormat: 'json', temperature: 0 }));
    expect(MarketAgentOutputSchema.safeParse(result.output).success).toBe(true);
    expect(repository.saveOutput).toHaveBeenCalledOnce();
  });
});
