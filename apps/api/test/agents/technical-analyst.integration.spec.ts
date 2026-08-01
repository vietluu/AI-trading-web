import { describe, expect, it, vi } from 'vitest';
import { TechnicalAgentOutputSchema } from '@platform/shared';
import { AgentOutputValidatorService } from '../../src/modules/agents/application/services/agent-output-validator.service';
import { AgentRunnerService } from '../../src/modules/agents/application/runners/agent-runner.service';
import {
  TECHNICAL_ANALYST_ALLOWED_TOOLS,
  TECHNICAL_ANALYST_DEFINITION,
} from '../../src/modules/agents/domain/definitions/technical-analyst.definition';
import {
  AgentInvocationSource,
  AgentRunState,
} from '../../src/modules/agents/domain/enums';

describe('Technical Analyst Agent runner integration', () => {
  it('runs BTC-USDT indicators and candles and persists structured output', async () => {
    const output = {
      summary: 'BTC-USDT is trending upward with neutral momentum.',
      trend: { direction: 'UP', strength: 'MODERATE' },
      momentum: {
        rsi: '58.2',
        rsiState: 'NEUTRAL',
        macd: { trend: 'BULLISH', crossover: 'NONE' },
      },
      movingAverages: { alignment: 'BULLISH', pricePosition: 'ABOVE' },
      volatility: {
        atr: '1200',
        bollinger: { position: 'MIDDLE', squeeze: false },
      },
      structure: { marketStructure: 'HH_HL', breakout: false },
      divergence: { rsiDivergence: 'NONE', macdDivergence: 'NONE' },
      signals: ['EMA20 is above EMA50.'],
      dataQuality: 'GOOD',
      usedTools: [...TECHNICAL_ANALYST_ALLOWED_TOOLS],
      generatedAt: new Date().toISOString(),
    };
    let run = {
      id: '00000000-0000-4000-8000-000000000011',
      status: AgentRunState.CREATED,
      traceId: 'trace-technical',
      output: null,
      toolCallCount: 0,
      toolRoundCount: 0,
    };
    const repository = {
      createRun: vi.fn().mockResolvedValue(run),
      updateRun: vi
        .fn()
        .mockImplementation((_id: string, update: Record<string, unknown>) =>
          Promise.resolve((run = { ...run, ...update })),
        ),
      addTransition: vi.fn().mockResolvedValue({}),
      saveOutput: vi.fn().mockResolvedValue({}),
    };
    const toolLoop = {
      runStep: vi
        .fn()
        .mockImplementation((calls: Array<{ toolName: string }>) =>
          Promise.resolve({
            shouldContinue: true,
            toolResults: calls.map((call, index) => ({
              providerCallId: `planned-${index + 1}`,
              toolName: call.toolName,
              result: {
                invocationId: `inv-${index + 1}`,
                toolName: call.toolName,
                toolVersion: 1,
                status: 'SUCCESS',
                data: { symbol: 'BTC-USDT' },
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
          }),
        ),
    };
    const orchestrator = {
      execute: vi.fn().mockResolvedValue({
        text: JSON.stringify(output),
        json: output,
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          estimatedCost: 0,
          totalTokens: 150,
        },
        provider: 'OPENAI',
        model: 'test-model',
      }),
    };
    const runner = new AgentRunnerService(
      orchestrator as never,
      repository as never,
      {
        buildAndPersistSnapshot: vi.fn().mockResolvedValue({
          snapshotId: 'snapshot-1',
          contextString: '{}',
          tokenEstimate: 1,
        }),
      } as never,
      {
        resolve: vi.fn().mockReturnValue({
          renderedPrompt: { systemPrompt: 'system', userPrompt: 'user' },
        }),
      } as never,
      {
        resolveTools: vi.fn().mockReturnValue({
          toolCount: 2,
          providerSchemas: [],
          resolvedToolNames: [...TECHNICAL_ANALYST_ALLOWED_TOOLS],
        }),
      } as never,
      { loadMemory: vi.fn(), persistOutput: vi.fn() } as never,
      new AgentOutputValidatorService(),
      {} as never,
      {
        acquireGlobal: vi.fn().mockResolvedValue({ acquired: true }),
        acquireUser: vi.fn().mockResolvedValue({ acquired: true }),
        acquireType: vi.fn().mockResolvedValue({ acquired: true }),
        releaseGlobal: vi.fn(),
        releaseUser: vi.fn(),
        releaseType: vi.fn(),
      } as never,
      {
        checkAndLock: vi.fn().mockResolvedValue({ locked: true }),
        unlock: vi.fn(),
        setResult: vi.fn(),
      } as never,
      { recordRun: vi.fn() } as never,
      toolLoop as never,
    );

    const result = await runner.run({
      definition: TECHNICAL_ANALYST_DEFINITION,
      userId: '00000000-0000-4000-8000-000000000012',
      input: {
        symbol: 'BTC-USDT',
        provider: 'BINANCE_FUTURES',
        interval: '1h',
      },
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
      correlationId: 'technical-correlation',
    });

    expect(result.status).toBe(AgentRunState.COMPLETED);
    expect(toolLoop.runStep.mock.calls[0]?.[0]).toHaveLength(2);
    expect(TechnicalAgentOutputSchema.safeParse(result.output).success).toBe(
      true,
    );
    expect(repository.saveOutput).toHaveBeenCalledOnce();
  });
});
