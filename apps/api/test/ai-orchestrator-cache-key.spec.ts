import { describe, expect, it, vi } from "vitest";
import { AIOrchestratorService } from "../src/modules/ai/application/ai-orchestrator.service";
import { CostEstimatorService } from "../src/modules/ai/infrastructure/budget/cost-estimator.service";
import { ModelRegistryService } from "../src/modules/ai/infrastructure/registry/model-registry.service";
import { PromptEngineService } from "../src/modules/ai/infrastructure/prompt/prompt-engine.service";
import { PromptRegistry } from "../src/modules/ai/infrastructure/prompt/prompt-registry";
import { PromptRenderer } from "../src/modules/ai/infrastructure/prompt/prompt-renderer";
import { ContextCompressor } from "../src/modules/ai/infrastructure/context/context-compressor";
import { ContextBuilderService } from "../src/modules/ai/infrastructure/context/context-builder.service";
import type { AIConfigService } from "../src/modules/ai/infrastructure/config/ai-config.service";
import type { BudgetManagerService } from "../src/modules/ai/infrastructure/budget/budget-manager.service";
import type { AIHistoryService } from "../src/modules/ai/infrastructure/history/ai-history.service";
import type { LLMProviderFactory } from "../src/modules/ai/infrastructure/provider/llm-provider.factory";
import type { LLMProvider } from "../src/modules/ai/domain/interfaces/llm-provider.interface";
import type { RedisService } from "../src/redis/redis.service";

describe("AIOrchestrator prompt cache key", () => {
  interface PromptCacheKeyParams {
    userId: string;
    provider: "OPENAI" | "ANTHROPIC" | "GEMINI" | "OLLAMA";
    model: string;
    symbol?: string;
    timeframe?: string;
    contextHash?: string;
    correlationId?: string;
    cycleKey?: string;
    systemPrompt?: string;
    userPrompt?: string;
    fullPrompt?: string;
    responseFormat?: "text" | "json";
    temperature?: number;
    maxTokens?: number;
    jsonSchema?: Record<string, unknown>;
  }

  interface OrchestratorWithPrivateMethods {
    buildPromptCacheKey(params: PromptCacheKeyParams): string;
  }

  function createTestOrchestrator(chatMock?: ReturnType<typeof vi.fn>) {
    const modelRegistry = new ModelRegistryService();
    const promptEngine = new PromptEngineService(new PromptRegistry(), new PromptRenderer());
    const contextBuilder = new ContextBuilderService(new ContextCompressor());

    const mockConfigService = {
      getOrCreateConfig: () =>
        Promise.resolve({
          id: "cfg-1",
          userId: "user-123",
          preferredProvider: "OPENAI",
          preferredModel: "gpt-5-mini",
          temperature: 0,
          maxTokens: 2048,
          timeoutMs: 5000,
          dailyBudget: 10,
          monthlyBudget: 100,
          tokenBudget: 1000000,
          requestBudget: 1000,
          fallbackEnabled: false,
          fallbackProviders: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
    } as unknown as AIConfigService;

    const mockBudgetManager = {
      checkBudget: () => Promise.resolve({ allowed: true, status: "OK" }),
      reserveRequest: () => Promise.resolve(),
      recordUsage: () => Promise.resolve(),
    } as unknown as BudgetManagerService;

    const mockHistoryService = {
      logExecution: () => Promise.resolve(),
    } as unknown as AIHistoryService;

    const resolvedChatMock = (chatMock ||
      vi.fn().mockResolvedValue({
        text: "mock analysis response",
        json: null,
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCost: 0.01 },
        latencyMs: 100,
        provider: "OPENAI" as const,
        model: "gpt-5-mini",
      })) as LLMProvider["chat"];

    const provider = {
      providerType: "OPENAI",
      chat: resolvedChatMock,
      stream: (async function* () {
        await Promise.resolve();
        yield { deltaToken: "", isComplete: true };
      }) as LLMProvider["stream"],
      embedding: vi.fn(),
      countTokens: vi.fn(),
      health: vi.fn(),
      listModels: vi.fn(),
    } as unknown as LLMProvider;

    const factoryWithStub = {
      getProvider: () => provider,
    } as unknown as LLMProviderFactory;

    const mockRedisService = {
      get: vi.fn().mockResolvedValue(null),
      setWithTtl: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisService;

    const orchestrator = new AIOrchestratorService(
      mockConfigService,
      mockBudgetManager,
      contextBuilder,
      promptEngine,
      factoryWithStub,
      mockHistoryService,
      new CostEstimatorService(modelRegistry),
      mockRedisService
    );

    return { orchestrator, chatMock: resolvedChatMock, mockRedisService };
  }

  it("same content with different correlationId and cycleKey should produce the same cache key", () => {
    const { orchestrator } = createTestOrchestrator();
    const serviceWithPrivate = orchestrator as unknown as OrchestratorWithPrivateMethods;

    const baseParams: PromptCacheKeyParams = {
      userId: "u1",
      provider: "GEMINI",
      model: "gemini-3.1-flash-lite",
      symbol: "BTCUSDT",
      timeframe: "1h",
      contextHash: "ctx-hash-1",
      systemPrompt: "sys prompt",
      userPrompt: "user prompt",
      fullPrompt: "sys prompt\nuser prompt",
      responseFormat: "json",
      temperature: 0,
      maxTokens: 1000,
    };

    const key1 = serviceWithPrivate.buildPromptCacheKey({
      ...baseParams,
      correlationId: "corr-111-aaa",
      cycleKey: "cycle-2026-09-01-01",
    });

    const key2 = serviceWithPrivate.buildPromptCacheKey({
      ...baseParams,
      correlationId: "corr-222-bbb",
      cycleKey: "cycle-2026-09-01-02",
    });

    const key3 = serviceWithPrivate.buildPromptCacheKey({
      ...baseParams,
      correlationId: undefined,
      cycleKey: undefined,
    });

    expect(key1).toBe(key2);
    expect(key1).toBe(key3);
  });

  it("different prompt content or params should produce different cache keys", () => {
    const { orchestrator } = createTestOrchestrator();
    const serviceWithPrivate = orchestrator as unknown as OrchestratorWithPrivateMethods;

    const baseParams: PromptCacheKeyParams = {
      userId: "u1",
      provider: "GEMINI",
      model: "gemini-3.1-flash-lite",
      symbol: "BTCUSDT",
      timeframe: "1h",
      contextHash: "ctx-hash-1",
      systemPrompt: "sys prompt",
      userPrompt: "user prompt",
      fullPrompt: "sys prompt\nuser prompt",
      responseFormat: "json",
      temperature: 0,
      maxTokens: 1000,
    };

    const baseKey = serviceWithPrivate.buildPromptCacheKey(baseParams);

    const diffUserKey = serviceWithPrivate.buildPromptCacheKey({
      ...baseParams,
      userId: "u2",
    });
    expect(diffUserKey).not.toBe(baseKey);

    const diffPromptKey = serviceWithPrivate.buildPromptCacheKey({
      ...baseParams,
      userPrompt: "different user prompt",
      fullPrompt: "sys prompt\ndifferent user prompt",
    });
    expect(diffPromptKey).not.toBe(baseKey);

    const diffTempKey = serviceWithPrivate.buildPromptCacheKey({
      ...baseParams,
      temperature: 0.7,
    });
    expect(diffTempKey).not.toBe(baseKey);
  });

  it("should hit cache across different requests that have different correlationId and cycleKey", async () => {
    const chatMock = vi.fn().mockResolvedValue({
      text: "cached analysis result",
      json: null,
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCost: 0.01 },
      latencyMs: 100,
      provider: "OPENAI" as const,
      model: "gpt-5-mini",
    });

    const { orchestrator } = createTestOrchestrator(chatMock);

    const first = await orchestrator.execute({
      userId: "user-123",
      userPrompt: "Analyze ETH trend",
      provider: "OPENAI",
      correlationId: "req-cycle-001",
      cycleKey: "cycle-1",
    });

    const second = await orchestrator.execute({
      userId: "user-123",
      userPrompt: "Analyze ETH trend",
      provider: "OPENAI",
      correlationId: "req-cycle-002",
      cycleKey: "cycle-2",
    });

    expect(first.text).toBe("cached analysis result");
    expect(second.text).toBe("cached analysis result");
    expect(chatMock).toHaveBeenCalledTimes(1);
  });
});
