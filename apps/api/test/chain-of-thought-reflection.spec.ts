import { describe, it, expect, vi } from 'vitest';
import { ChainOfThoughtReflectionService } from '../src/modules/agents/application/services/chain-of-thought-reflection.service';

const mockOrchestrator = {
  execute: vi.fn(),
};

const mockConfig = {
  get: vi.fn((key: string, defaultValue?: any) => {
    const values: Record<string, any> = {
      LLM_REFLECTION_ENABLED: true,
      LLM_REFLECTION_TIMEOUT_MS: 8000,
      LLM_REFLECTION_MODEL: 'gemini-3.1-flash-lite',
    };
    return values[key] ?? defaultValue;
  }),
};

function makeService(opts?: { orchestrator?: any; config?: any }) {
  return new ChainOfThoughtReflectionService(
    opts?.orchestrator ?? mockOrchestrator,
    opts?.config ?? mockConfig,
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
        get: (k: string, d: any) => (k === 'LLM_REFLECTION_ENABLED' ? false : d),
      } as any,
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
    const service = new ChainOfThoughtReflectionService(undefined, mockConfig as any);
    const result = await service.reflect(baseInput);
    expect(result.adjustedDecision).toBe('LONG');
  });

  it('builds prompt correctly', async () => {
    const service = makeService();
    mockOrchestrator.execute.mockResolvedValueOnce({
      response: JSON.stringify({
        adjustedDecision: 'LONG',
        adjustedConfidence: 75,
        reasoning: 'Good trade',
        contrarianArguments: ['Too high', 'RSI overbought', 'Fed meeting'],
        trapProbability: 10,
      }),
    });
    await service.reflect(baseInput);
    expect(mockOrchestrator.execute).toHaveBeenCalled();
    const args = mockOrchestrator.execute.mock.calls[0][0];
    expect(args.userPrompt).toContain('BTCUSDT');
    expect(args.userPrompt).toContain('Bullish trend');
  });

  it('parses valid json response', async () => {
    const service = makeService();
    mockOrchestrator.execute.mockResolvedValueOnce({
      response: JSON.stringify({
        adjustedDecision: 'SHORT',
        adjustedConfidence: 60,
        reasoning: 'Looks bearish actually',
        contrarianArguments: ['A', 'B', 'C'],
        trapProbability: 40,
        overrideReason: 'Found a trap',
      }),
    });
    const result = await service.reflect(baseInput);
    expect(result.adjustedDecision).toBe('SHORT');
    expect(result.adjustedConfidence).toBe(60);
    expect(result.trapProbability).toBe(40);
    expect(result.overrideReason).toBe('Found a trap');
  });

  it('falls back to passthrough on invalid json', async () => {
    const service = makeService();
    mockOrchestrator.execute.mockResolvedValueOnce({
      response: 'this is not json',
    });
    const result = await service.reflect(baseInput);
    expect(result.adjustedDecision).toBe('LONG');
    expect(result.reasoning).toContain('passthrough');
  });

  it('adjusts decision to WAIT if trapProbability > 70 is handled by decision service, but here we just parse it', async () => {
    const service = makeService();
    mockOrchestrator.execute.mockResolvedValueOnce({
      response: JSON.stringify({
        adjustedDecision: 'LONG',
        adjustedConfidence: 75,
        reasoning: 'Test',
        contrarianArguments: [],
        trapProbability: 80,
      }),
    });
    const result = await service.reflect(baseInput);
    expect(result.trapProbability).toBe(80);
  });
});
