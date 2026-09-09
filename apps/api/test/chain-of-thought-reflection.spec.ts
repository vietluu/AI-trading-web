import { describe, it, expect, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AIOrchestratorService } from '../src/modules/ai/application/ai-orchestrator.service';
import { ChainOfThoughtReflectionService } from '../src/modules/agents/application/services/chain-of-thought-reflection.service';
import { AnticipatoryMarketSnapshot, TradeThesis } from '@platform/shared';

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
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 },
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

const mockSnapshot = {
  symbol: 'BTC-USDT',
  timeframe: '15m',
  structure: { coverage: 'AVAILABLE' }
} as unknown as AnticipatoryMarketSnapshot;

const mockThesis: TradeThesis = {
  thesisVersion: 1,
  decisionSource: 'AI',
  state: 'PROBE_READY',
  direction: 'LONG',
  regime: 'TRENDING_BULL',
  transitionProbability: 0.1,
  setup: 'TREND_PULLBACK',
  entryZone: { lower: 60000, upper: 61000 },
  trigger: [],
  invalidation: { price: 59000, reason: 'Support broke' },
  stopLoss: 59000,
  targets: [{ price: 65000, fraction: 1 }],
  expectedNetR: 2.5,
  maximumChaseDistanceAtr: 1,
  confidence: 75,
  evidenceFor: [],
  evidenceAgainst: [],
  missingEvidence: [],
  expiresAt: new Date().toISOString(),
};

describe('ChainOfThoughtReflectionService as Critic', () => {
  it('returns APPROVE passthrough when disabled', async () => {
    const service = makeService({
      config: {
        get: (key: string, defaultValue?: unknown) => key === 'LLM_REFLECTION_ENABLED' ? false : defaultValue,
      } as unknown as ConfigService,
    });
    const result = await service.reflect({ snapshot: mockSnapshot, thesis: mockThesis });
    expect(result.action).toBe('APPROVE');
    expect(result.rationale).toContain('passthrough');
    expect((result as any).adjustedDecision).toBeUndefined();
  });

  it('builds prompt containing scenario/thesis geometry', async () => {
    const service = makeService();
    mockOrchestrator.execute.mockResolvedValueOnce(aiResponse(JSON.stringify({
      action: 'APPROVE',
      reasonCodes: [],
      evidenceRefs: [],
      rationale: 'Looks good'
    })));
    await service.reflect({ snapshot: mockSnapshot, thesis: mockThesis });
    expect(mockOrchestrator.execute).toHaveBeenCalled();
    const args = mockOrchestrator.execute.mock.calls[0]![0];
    expect(args.userPrompt).toContain('BTC-USDT');
    expect(args.userPrompt).toContain('60000');
    expect(args.userPrompt).toContain('59000');
  });

  it('parses contrary opinion without reversing direction', async () => {
    const service = makeService();
    mockOrchestrator.execute.mockResolvedValueOnce(aiResponse(JSON.stringify({
      action: 'CANCEL',
      reasonCodes: ['TRAP_DETECTED'],
      evidenceRefs: [],
      rationale: 'Looks like a bear trap'
    })));
    const result = await service.reflect({ snapshot: mockSnapshot, thesis: mockThesis });
    expect(result.action).toBe('CANCEL');
    expect((result as any).adjustedDecision).toBeUndefined();
  });
  
  it('cannot output adjustedDecision', async () => {
    const service = makeService();
    mockOrchestrator.execute.mockResolvedValueOnce(aiResponse(JSON.stringify({
      action: 'CANCEL',
      adjustedDecision: 'SHORT',
      reasonCodes: [],
      evidenceRefs: [],
      rationale: 'I want to short'
    })));
    const result = await service.reflect({ snapshot: mockSnapshot, thesis: mockThesis });
    expect(result.action).toBe('CANCEL');
    expect((result as any).adjustedDecision).toBeUndefined();
  });

  it('safely falls back to REQUIRE_TRIGGER when AI returns malformed JSON', async () => {
    const service = makeService();
    mockOrchestrator.execute.mockResolvedValueOnce(aiResponse('Here is my thought: { action: "CANCEL", invalidJson: true }'));
    const result = await service.reflect({ snapshot: mockSnapshot, thesis: mockThesis });
    expect(result.action).toBe('REQUIRE_TRIGGER');
    expect(result.reasonCodes).toContain('CRITIC_PARSE_FAILED');
  });

  it('safely falls back to REQUIRE_TRIGGER when AI returns no JSON', async () => {
    const service = makeService();
    mockOrchestrator.execute.mockResolvedValueOnce(aiResponse('I agree with the thesis, approve it.'));
    const result = await service.reflect({ snapshot: mockSnapshot, thesis: mockThesis });
    expect(result.action).toBe('REQUIRE_TRIGGER');
    expect(result.reasonCodes).toContain('CRITIC_NO_JSON');
  });

  it('returns APPROVE passthrough if orchestrator is not injected', async () => {
    const service = makeService({ orchestrator: undefined });
    const result = await service.reflect({ snapshot: mockSnapshot, thesis: mockThesis });
    expect(result.action).toBe('APPROVE');
    expect(result.rationale).toContain('passthrough');
  });

  it('returns APPROVE passthrough if thesis is WAIT', async () => {
    const service = makeService();
    const waitThesis = { ...mockThesis, direction: 'WAIT' } as TradeThesis;
    const result = await service.reflect({ snapshot: mockSnapshot, thesis: waitThesis });
    expect(result.action).toBe('APPROVE');
    expect(result.rationale).toContain('passthrough');
  });
});
