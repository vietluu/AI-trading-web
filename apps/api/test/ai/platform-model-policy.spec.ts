import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIOrchestratorService } from '../../src/modules/ai/application/ai-orchestrator.service';
import { GeminiProvider } from '../../src/modules/ai/infrastructure/provider/gemini.provider';
import { ModelRegistryService } from '../../src/modules/ai/infrastructure/registry/model-registry.service';
import { TRADE_THESIS_JSON_SCHEMA } from '../../src/modules/agents/domain/prompts/trade-researcher.prompt';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function fixture(configured = true) {
  const response = { text: 'analysis', json: null, finishReason: 'STOP', provider: 'GEMINI',
    model: 'gemini-3.1-flash-lite', latencyMs: 1,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCost: 0.00001 } };
  const gemini = { providerType: 'GEMINI', isConfigured: () => configured,
    chat: vi.fn().mockResolvedValue(response), listModels: vi.fn().mockResolvedValue([{ name: 'gemini-image' }]),
    stream: vi.fn(async function* () { await Promise.resolve(); yield { deltaToken: 'analysis', isComplete: true }; }) };
  const other = { providerType: 'ANTHROPIC', isConfigured: () => true, chat: vi.fn().mockResolvedValue(response) };
  const service = new AIOrchestratorService(
    { getOrCreateConfig: vi.fn().mockResolvedValue({ preferredProvider: 'ANTHROPIC', preferredModel: 'legacy',
      fallbackEnabled: true, fallbackProviders: ['OLLAMA'], temperature: 0, maxTokens: 100, timeoutMs: 1000 }) } as never,
    { checkBudget: vi.fn().mockResolvedValue({ allowed: true }), reserveRequest: vi.fn(), releaseRequest: vi.fn(), recordUsage: vi.fn() } as never,
    {} as never, { renderDirect: () => ({ userPrompt: 'test', fullPrompt: 'test' }) } as never,
    { getProvider: (type: string) => type === 'GEMINI' ? gemini : other, getAllProviders: () => [other, gemini] } as never,
    { logExecution: vi.fn() } as never, {} as never,
    { get: vi.fn().mockResolvedValue(null), setWithTtl: vi.fn(), delete: vi.fn() } as never,
  );
  return { service, gemini, other };
}

describe('platform model allowlist', () => {
  it('ignores legacy preferences and explicit non-whitelisted models before any provider call', async () => {
    const { service, gemini, other } = fixture();
    await service.execute({ userId: 'user', userPrompt: 'test', provider: 'OLLAMA', model: 'gemini-image' });
    expect(gemini.chat).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.1-flash-lite' }));
    expect(other.chat).not.toHaveBeenCalled();
    expect(gemini.listModels).not.toHaveBeenCalled();
  });

  it('fails closed without a Gemini credential instead of attempting other providers', async () => {
    const { service, gemini, other } = fixture(false);
    await expect(service.execute({ userId: 'user', userPrompt: 'test' })).rejects.toThrow();
    expect(gemini.chat).not.toHaveBeenCalled();
    expect(other.chat).not.toHaveBeenCalled();
  });

  it('does not fall back to discovered or non-Gemini models on provider failure', async () => {
    const { service, gemini, other } = fixture();
    gemini.chat.mockRejectedValue(Object.assign(new Error('unavailable'), { status: 503 }));
    await expect(service.execute({ userId: 'user', userPrompt: 'test' })).rejects.toThrow();
    expect(gemini.chat).toHaveBeenCalled();
    for (const [request] of gemini.chat.mock.calls) {
      expect((request as { model: string }).model).toBe('gemini-3.1-flash-lite');
    }
    expect(other.chat).not.toHaveBeenCalled();
  });

  it('enforces the same allowlist for streaming', async () => {
    const { service, gemini } = fixture();
    for await (const chunk of service.stream({ userId: 'user', userPrompt: 'test', provider: 'OLLAMA', model: 'other' })) {
      expect(chunk.deltaToken).toBe('analysis');
    }
    expect(gemini.stream).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.1-flash-lite' }));
  });
});

describe('Gemini usage accounting', () => {
  it('sends the supplied thesis JSON schema to Gemini, not only a JSON mime type', async () => {
    const schema = TRADE_THESIS_JSON_SCHEMA;
    const provider = new GeminiProvider({ get: (key: string) => key === 'GOOGLE_API_KEY' ? 'test-key' : undefined } as never,
      new ModelRegistryService());
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"preferred":"WAIT"}' }] } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await provider.chat({ model: 'gemini-3.1-flash-lite', userPrompt: 'test', jsonSchema: schema });
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string) as {
      generationConfig: { responseJsonSchema: typeof schema };
    };
    expect(body.generationConfig.responseJsonSchema).toEqual(schema);
    const items = body.generationConfig.responseJsonSchema.properties.alternatives.items;
    expect(items.type).toBe('object');
    for (const key of ['direction', 'entryZone', 'stopLoss', 'evidenceFor']) expect(items.required).toContain(key);
  });

  it('accounts for paid text rates and thinking tokens, not zero cost', async () => {
    vi.stubEnv('MOCK_AI_RESPONSES', 'false');
    const provider = new GeminiProvider({ get: (key: string) => key === 'GOOGLE_API_KEY' ? 'test-key' : undefined } as never,
      new ModelRegistryService());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 100, totalTokenCount: 1300 },
    }), { status: 200 })));
    const result = await provider.chat({ model: 'gemini-3.1-flash-lite', userPrompt: 'test' });
    expect(result.usage).toEqual({ promptTokens: 1000, completionTokens: 300, totalTokens: 1300, estimatedCost: 0.0007 });
  });
});
