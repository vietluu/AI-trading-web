import { describe, it, expect, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AIOrchestratorService } from '../src/modules/ai/application/ai-orchestrator.service';
import { ChainOfThoughtReflectionService } from '../src/modules/agents/application/services/chain-of-thought-reflection.service';

const mockOrchestrator = {
  execute: vi.fn<AIOrchestratorService['execute']>(),
};

function aiResponse(text: string) {
  return {
    latencyMs: 1,
    provider: 'GEMINI' as const,
    json: null,
    model: 'gemini-3.1-flash-lite',
    text,
    finishReason: 'stop',
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      estimatedCost: 0,
    },
  };
}

const mockConfig = {
  get: vi.fn((key: string, defaultValue?: unknown) => {
    const values: Record<string, unknown> = {
      LLM_REFLECTION_ENABLED: true,
      LLM_REFLECTION_TIMEOUT_MS: 8000,
      LLM_REFLECTION_MODEL: 'gemini-3.1-flash-lite',
    };
    return values[key] ?? defaultValue;
  }),
};

function makeService(opts?: { orchestrator?: AIOrchestratorService; config?: ConfigService }) {
  return new ChainOfThoughtReflectionService(
    opts?.orchestrator ?? mockOrchestrator as unknown as AIOrchestratorService,
    opts?.config ?? mockConfig as unknown as ConfigService,
  );
}

const baseInput = {
  symbol: 'BTCUSDT',
  candidateDecision: 'LONG' as const,
  confidence: 75,
  regime: 'TRENDING_BULL',
  agentSummaries: { market: 'Bullish trend', technical: 'EMA cross up' },
};

describe('ChainOfThoughtReflectionService', () => {
  it('passes through when disabled', async () => {
    const service = makeService({
      config: {
        get: (key: string, defaultValue?: unknown) =>
          key === 'LLM_REFLECTION_ENABLED' ? false : defaultValue,
      } as unknown as ConfigService,
    });
    const result = await service.reflect(baseInput);
    expect(result.adjustedDecision).toBe('LONG');
    expect(result.reasoning).toContain('passthrough');
  });

  it('passes through for WAIT decision', async () => {
    const service = makeService();
    const result = await service.reflect({ ...baseInput, candidateDecision: 'WAIT' });
    expect(result.adjustedDecision).toBe('WAIT');
    expect(result.reasoning).toContain('passthrough');
  });

  it('passes through when no orchestrator', async () => {
    const service = new ChainOfThoughtReflectionService(
      undefined,
      mockConfig as unknown as ConfigService,
    );
    const result = await service.reflect(baseInput);
    expect(result.adjustedDecision).toBe('LONG');
  });

  it('builds prompt correctly', async () => {
    const service = makeService();
    mockOrchestrator.execute.mockResolvedValueOnce(aiResponse(JSON.stringify({
        adjustedDecision: 'LONG',
        adjustedConfidence: 75,
        reasoning: 'Good trade',
        contrarianArguments: ['Too high', 'RSI overbought', 'Fed meeting'],
        trapProbability: 10,
      })));
    await service.reflect(baseInput);
    expect(mockOrchestrator.execute).toHaveBeenCalled();
    const args = mockOrchestrator.execute.mock.calls[0]![0];
    expect(args.userPrompt).toContain('BTCUSDT');
    expect(args.userPrompt).toContain('Bullish trend');
  });

  it('parses valid json response', async () => {
    const service = makeService();
    mockOrchestrator.execute.mockResolvedValueOnce(aiResponse(JSON.stringify({
        adjustedDecision: 'SHORT',
        adjustedConfidence: 60,
        reasoning: 'Looks bearish actually',
        contrarianArguments: ['A', 'B', 'C'],
        trapProbability: 40,
        overrideReason: 'Found a trap',
      })));
    const result = await service.reflect(baseInput);
    expect(result.adjustedDecision).toBe('SHORT');
    expect(result.adjustedConfidence).toBe(60);
    expect(result.trapProbability).toBe(40);
    expect(result.overrideReason).toBe('Found a trap');
  });

  it('falls back to passthrough on invalid json', async () => {
    const service = makeService();
    mockOrchestrator.execute.mockResolvedValueOnce(aiResponse('this is not json'));
    const result = await service.reflect(baseInput);
    expect(result.adjustedDecision).toBe('LONG');
    expect(result.reasoning).toContain('passthrough');
  });

  it('adjusts decision to WAIT if trapProbability > 70 is handled by decision service, but here we just parse it', async () => {
    const service = makeService();
    mockOrchestrator.execute.mockResolvedValueOnce(aiResponse(JSON.stringify({
        adjustedDecision: 'LONG',
        adjustedConfidence: 75,
        reasoning: 'Test',
        contrarianArguments: [],
        trapProbability: 80,
      })));
    const result = await service.reflect(baseInput);
    expect(result.trapProbability).toBe(80);
  });
});
