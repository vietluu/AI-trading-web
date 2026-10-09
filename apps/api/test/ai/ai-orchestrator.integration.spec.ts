import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { type RedisService } from "../../src/redis/redis.service";
import { ModelRegistryService } from "../../src/modules/ai/infrastructure/registry/model-registry.service";
import { OpenAIProvider } from "../../src/modules/ai/infrastructure/provider/openai.provider";
import { AnthropicProvider } from "../../src/modules/ai/infrastructure/provider/anthropic.provider";
import { GeminiProvider } from "../../src/modules/ai/infrastructure/provider/gemini.provider";
import { OllamaProvider } from "../../src/modules/ai/infrastructure/provider/ollama.provider";
import { LLMProviderFactory } from "../../src/modules/ai/infrastructure/provider/llm-provider.factory";
import { PromptRegistry } from "../../src/modules/ai/infrastructure/prompt/prompt-registry";
import { PromptRenderer } from "../../src/modules/ai/infrastructure/prompt/prompt-renderer";
import { PromptEngineService } from "../../src/modules/ai/infrastructure/prompt/prompt-engine.service";
import { ContextCompressor } from "../../src/modules/ai/infrastructure/context/context-compressor";
import { ContextBuilderService } from "../../src/modules/ai/infrastructure/context/context-builder.service";
import { CostEstimatorService } from "../../src/modules/ai/infrastructure/budget/cost-estimator.service";
import { AIOrchestratorService } from "../../src/modules/ai/application/ai-orchestrator.service";
import type { AIConfigService } from "../../src/modules/ai/infrastructure/config/ai-config.service";
import type { BudgetManagerService } from "../../src/modules/ai/infrastructure/budget/budget-manager.service";
import type { AIHistoryService } from "../../src/modules/ai/infrastructure/history/ai-history.service";
import type { LLMProvider } from "../../src/modules/ai/domain/interfaces/llm-provider.interface";
import type { Prisma } from "@prisma/client";

describe("AI Orchestrator & Fallback Integration", () => {
  let modelRegistry: ModelRegistryService;
  let openAIProvider: OpenAIProvider;
  let anthropicProvider: AnthropicProvider;
  let geminiProvider: GeminiProvider;
  let ollamaProvider: OllamaProvider;
  let factory: LLMProviderFactory;
  let promptEngine: PromptEngineService;
  let contextBuilder: ContextBuilderService;
  let orchestrator: AIOrchestratorService;
  let mockConfigService: AIConfigService;
  let mockBudgetManager: BudgetManagerService;
  let reserveRequest: ReturnType<typeof vi.fn>;
  let releaseRequest: ReturnType<typeof vi.fn>;
  let mockHistoryService: AIHistoryService;
  let mockRedisService: RedisService;

  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.stubEnv("MOCK_AI_RESPONSES", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubEnv("GOOGLE_API_KEY", "test-google-key");
    mockConfigService = {
      getOrCreateConfig: () =>
        Promise.resolve({
          id: "cfg-1",
          userId: "user-123",
          preferredProvider: "OPENAI",
          preferredModel: "gpt-5-mini",
          temperature: 0.7,
          maxTokens: 2048,
          timeoutMs: 5000,
          dailyBudget: 10 as unknown as Prisma.Decimal,
          monthlyBudget: 100 as unknown as Prisma.Decimal,
          tokenBudget: 1000000,
          requestBudget: 1000,
          fallbackEnabled: true,
          fallbackProviders: ["ANTHROPIC", "GEMINI", "OLLAMA"],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
    } as unknown as AIConfigService;

    reserveRequest = vi.fn().mockResolvedValue(undefined);
    releaseRequest = vi.fn().mockResolvedValue(undefined);
    mockBudgetManager = {
      checkBudget: () => Promise.resolve({ allowed: true, status: "OK" }),
      reserveRequest,
      releaseRequest,
      recordUsage: vi.fn().mockResolvedValue(undefined),
    } as unknown as BudgetManagerService;

    mockHistoryService = {
      logExecution: () => Promise.resolve(),
    } as unknown as AIHistoryService;

    mockRedisService = {
      get: vi.fn().mockResolvedValue(null),
      setWithTtl: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisService;

    const mockEnvConfig = {
      get: (key: string) => process.env[key],
    } as unknown as ConfigService;
    modelRegistry = new ModelRegistryService();
    openAIProvider = new OpenAIProvider(mockEnvConfig, modelRegistry);
    anthropicProvider = new AnthropicProvider(mockEnvConfig, modelRegistry);
    geminiProvider = new GeminiProvider(mockEnvConfig, modelRegistry);
    ollamaProvider = new OllamaProvider(mockEnvConfig, modelRegistry);

    factory = new LLMProviderFactory(
      openAIProvider,
      anthropicProvider,
      geminiProvider,
      ollamaProvider,
    );

    const registry = new PromptRegistry();
    const renderer = new PromptRenderer();
    promptEngine = new PromptEngineService(registry, renderer);

    const compressor = new ContextCompressor();
    contextBuilder = new ContextBuilderService(compressor);

    const costEstimator = new CostEstimatorService(modelRegistry);

    orchestrator = new AIOrchestratorService(
      mockConfigService,
      mockBudgetManager,
      contextBuilder,
      promptEngine,
      factory,
      mockHistoryService,
      costEstimator,
      mockRedisService,
    );
  });

  it("does not admit independent fallback providers into the platform allowlist", () => {
    const candidates = (
      orchestrator as unknown as {
        buildCandidates: (
          provider: "GEMINI",
          model: string,
          fallbacks: Array<"OPENAI">,
        ) => Array<{ provider: string; model: string }>;
      }
    ).buildCandidates("GEMINI", "gemini-3.1-flash-lite", ["OPENAI"]);

    expect(candidates.slice(0, 2)).toEqual([
      { provider: "GEMINI", model: "gemini-3.1-flash-lite" },
    ]);
  });

  it("does not admit discovered models into the platform allowlist", () => {
    const candidates = (
      orchestrator as unknown as {
        buildCandidates: (
          provider: "GEMINI",
          model: string,
          fallbacks: [],
          discoveredModels: string[],
        ) => Array<{ provider: string; model: string }>;
      }
    ).buildCandidates(
      "GEMINI",
      "gemini-primary",
      [],
      ["gemini-primary", "gemini-current-flash"],
    );

    expect(candidates).toEqual([
      { provider: "GEMINI", model: "gemini-3.1-flash-lite" },
    ]);
  });

  it("should execute AI Request successfully using default preferred provider", async () => {
    const res = await orchestrator.execute({
      userId: "user-123",
      userPrompt: "Analyze ETH 4h trend",
    });

    expect(res.text).toBeDefined();
    expect(res.provider).toBe("GEMINI");
    expect(res.usage.totalTokens).toBeGreaterThan(0);
  });

  it("forwards a caller deadline to the selected provider", async () => {
    const chat = vi.spyOn(geminiProvider, "chat");

    await orchestrator.execute({
      userId: "user-123",
      userPrompt: "deadline propagation",
      timeoutMs: 8000,
    });

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 8000 }),
    );
  });

  it("uses configured Gemini when the persisted primary provider has no key", async () => {
    vi.stubEnv("MOCK_AI_RESPONSES", "false");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const geminiChat = vi.spyOn(geminiProvider, "chat").mockResolvedValue({
      text: "gemini analysis",
      json: null,
      finishReason: "stop",
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        estimatedCost: 0,
      },
      latencyMs: 1,
      provider: "GEMINI",
      model: "gemini-3.1-flash-lite",
    });
    const openAIChat = vi.spyOn(openAIProvider, "chat");

    const response = await orchestrator.execute({
      userId: "user-123",
      userPrompt: "Route to the configured provider",
    });

    expect(response.provider).toBe("GEMINI");
    expect(openAIChat).not.toHaveBeenCalled();
    expect(geminiChat).toHaveBeenCalledOnce();
  });

  it("does not count a failed provider attempt against the request budget", async () => {
    geminiProvider.chat = vi.fn().mockRejectedValue(
      Object.assign(new Error("Gemini unavailable"), { status: 503 }),
    );

    await expect(orchestrator.execute({
      userId: "user-123",
      userPrompt: "Fallback without charging the failed attempt",
      provider: "OPENAI",
    })).rejects.toThrow();
    expect(reserveRequest).toHaveBeenCalledTimes(1);
    expect(releaseRequest).toHaveBeenCalledTimes(1);
  });

  it("routes legacy OpenAI preferences to approved Gemini without calling OpenAI", async () => {
    openAIProvider.chat = () => {
      const err = new Error("Rate limit exceeded 429");
      Object.assign(err, { status: 429 });
      return Promise.reject(err);
    };

    const res = await orchestrator.execute({
      userId: "user-123",
      userPrompt: "Analyze SOL funding rates",
      provider: "OPENAI",
    });

    expect(res.provider).toBe("GEMINI");
  });

  it("keeps only the platform model despite legacy fallback preferences", () => {
    const buildCandidates = (
      orchestrator as unknown as {
        buildCandidates: (
          p: string,
          m: string,
          f: string[],
        ) => Array<{ provider: string; model: string }>;
      }
    ).buildCandidates.bind(orchestrator);
    const candidates = buildCandidates("OPENAI", "gpt-5-mini", [
      "ANTHROPIC",
      "GEMINI",
    ]);

    expect(
      candidates.map((candidate) => `${candidate.provider}:${candidate.model}`),
    ).toEqual([
      "GEMINI:gemini-3.1-flash-lite",
    ]);
  });

  it("does not select legacy auth-broken providers", async () => {
    openAIProvider.chat = () => {
      const err = new Error("Invalid API key (401)");
      Object.assign(err, { status: 401 });
      return Promise.reject(err);
    };

    const response = await orchestrator.execute({
      userId: "user-123",
      userPrompt: "Test provider-scoped 401 fallback",
      provider: "OPENAI",
    });

    expect(response.provider).toBe("GEMINI");
  });

  it("ignores legacy primary models and unapproved fallback credentials", async () => {
    const calls: string[] = [];
    const provider = (providerType: "GEMINI" | "OPENAI") =>
      ({
        providerType,
        chat: vi.fn((options: { model: string }) => {
          calls.push(`${providerType}:${options.model}`);
          if (providerType === "OPENAI") {
            return Promise.reject(
              Object.assign(new Error("Invalid API key"), { status: 401 }),
            );
          }
          if (options.model === "gemini-primary") {
            return Promise.reject(
              Object.assign(new Error("Primary unavailable"), { status: 503 }),
            );
          }
          return Promise.resolve({
            text: "fallback analysis",
            json: null,
            finishReason: "stop",
            usage: {
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
              estimatedCost: 0,
            },
            latencyMs: 1,
            provider: "GEMINI",
            model: options.model,
          });
        }),
      }) as unknown as LLMProvider;
    const fallbackFactory = {
      getProvider: (providerType: "GEMINI" | "OPENAI") =>
        provider(providerType),
    } as unknown as LLMProviderFactory;
    const baseConfig = await mockConfigService.getOrCreateConfig("user-123");
    const geminiConfig = {
      getOrCreateConfig: () =>
        Promise.resolve({
          ...baseConfig,
          preferredProvider: "GEMINI" as const,
          preferredModel: "gemini-primary",
          fallbackEnabled: true,
          fallbackProviders: ["OPENAI"],
        }),
    } as unknown as AIConfigService;
    const fallbackOrchestrator = new AIOrchestratorService(
      geminiConfig,
      mockBudgetManager,
      contextBuilder,
      promptEngine,
      fallbackFactory,
      mockHistoryService,
      new CostEstimatorService(modelRegistry),
    );

    const response = await fallbackOrchestrator.execute({
      userId: "user-123",
      userPrompt: "Exercise the complete fallback chain",
    });

    expect(calls.slice(0, 4)).toEqual([
      "GEMINI:gemini-3.1-flash-lite",
    ]);
    expect(response).toMatchObject({
      provider: "GEMINI",
      model: "gemini-3.1-flash-lite",
    });
  });

  it("does not send fallback requests to a provider that is not configured", async () => {
    const anthropicChat = vi.fn();
    const geminiChat = vi.fn((options: { model: string }) => {
      if (options.model === "gemini-primary") {
        return Promise.reject(new Error("Primary model unavailable"));
      }
      return Promise.resolve({
        text: "gemini fallback",
        json: null,
        finishReason: "stop",
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          estimatedCost: 0,
        },
        latencyMs: 1,
        provider: "GEMINI" as const,
        model: options.model,
      });
    });
    const providers = {
      GEMINI: {
        providerType: "GEMINI",
        chat: geminiChat,
        isConfigured: vi.fn().mockReturnValue(true),
        listModels: vi.fn().mockResolvedValue([
          {
            name: "gemini-current-flash",
            provider: "GEMINI",
            contextWindow: 1_000_000,
            maxOutputTokens: 8_192,
            inputCostPer1k: 0,
            outputCostPer1k: 0,
            supportsStreaming: true,
            supportsJson: true,
            supportsTools: true,
          },
        ]),
        health: vi.fn().mockResolvedValue({ status: "HEALTHY" }),
      },
      ANTHROPIC: {
        providerType: "ANTHROPIC",
        chat: anthropicChat,
        isConfigured: vi.fn().mockReturnValue(false),
        health: vi.fn().mockResolvedValue({ status: "HEALTHY" }),
      },
    } as const;
    const providerFactory = {
      getProvider: (provider: keyof typeof providers) => providers[provider],
      getAllProviders: () => Object.values(providers),
    } as unknown as LLMProviderFactory;
    const baseConfig = await mockConfigService.getOrCreateConfig("user-123");
    const geminiOnlyRuntime = new AIOrchestratorService(
      {
        getOrCreateConfig: () =>
          Promise.resolve({
            ...baseConfig,
            preferredProvider: "GEMINI" as const,
            preferredModel: "gemini-primary",
            fallbackEnabled: true,
            fallbackProviders: ["ANTHROPIC"],
          }),
      } as unknown as AIConfigService,
      mockBudgetManager,
      contextBuilder,
      promptEngine,
      providerFactory,
      mockHistoryService,
      new CostEstimatorService(modelRegistry),
    );

    const response = await geminiOnlyRuntime.execute({
      userId: "user-123",
      userPrompt: "Use only configured providers",
    });

    expect(anthropicChat).not.toHaveBeenCalled();
    expect(providers.ANTHROPIC.health).not.toHaveBeenCalled();
    expect(response.provider).toBe("GEMINI");
  });

  it("should not retry the same provider request multiple times", async () => {
    const chatMock = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("Rate limit exceeded 429"), { status: 429 }),
      );
    const provider = {
      providerType: "OPENAI",
      chat: chatMock as LLMProvider["chat"],
      stream: async function* () {
        await Promise.resolve();
        yield { deltaToken: "", isComplete: true };
      } as LLMProvider["stream"],
      embedding: vi.fn(),
      countTokens: vi.fn(),
      health: vi.fn(),
      listModels: vi.fn(),
    } as unknown as LLMProvider;

    const factoryWithStub = {
      getProvider: () => provider,
    } as unknown as LLMProviderFactory;

    const baseConfig = await (mockConfigService.getOrCreateConfig?.(
      "user-123",
    ) ?? Promise.resolve({}));
    const noRetryConfig = {
      ...mockConfigService,
      getOrCreateConfig: () =>
        Promise.resolve({
          ...baseConfig,
          fallbackEnabled: false,
          fallbackProviders: [],
        }),
    } as unknown as AIConfigService;

    const orchestratorNoRetry = new AIOrchestratorService(
      noRetryConfig,
      mockBudgetManager,
      contextBuilder,
      promptEngine,
      factoryWithStub,
      mockHistoryService,
      new CostEstimatorService(modelRegistry),
      mockRedisService,
    );

    await expect(
      orchestratorNoRetry.execute({
        userId: "user-123",
        userPrompt: "Should not retry",
        provider: "OPENAI",
      }),
    ).rejects.toThrow("AI Request failed");

    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("shares a provider quota cooldown and suppresses unsent failure history", async () => {
    const chatMock = vi.fn().mockRejectedValue(
      Object.assign(new Error("Rate limit exceeded 429"), {
        status: 429,
        retryAfterMs: 60_000,
        providerRequestSent: true,
      }),
    );
    const provider = {
      providerType: "OPENAI",
      chat: chatMock as LLMProvider["chat"],
    } as unknown as LLMProvider;
    const factoryWithStub = {
      getProvider: () => provider,
    } as unknown as LLMProviderFactory;
    const baseConfig = await mockConfigService.getOrCreateConfig("user-123");
    const noFallbackConfig = {
      getOrCreateConfig: () =>
        Promise.resolve({
          ...baseConfig,
          preferredProvider: "OPENAI" as const,
          fallbackEnabled: false,
          fallbackProviders: [],
        }),
    } as unknown as AIConfigService;
    const redisValues = new Map<string, string>();
    const redis = {
      get: vi.fn((key: string) =>
        Promise.resolve(redisValues.get(key) ?? null),
      ),
      setWithTtl: vi.fn((key: string, value: string) => {
        redisValues.set(key, value);
        return Promise.resolve();
      }),
      delete: vi.fn((key: string) => {
        redisValues.delete(key);
        return Promise.resolve();
      }),
    } as unknown as RedisService;
    const historyLog = vi.fn().mockResolvedValue(undefined);
    const history = {
      logExecution: historyLog,
    } as unknown as AIHistoryService;
    const cooldownOrchestrator = new AIOrchestratorService(
      noFallbackConfig,
      mockBudgetManager,
      contextBuilder,
      promptEngine,
      factoryWithStub,
      history,
      new CostEstimatorService(modelRegistry),
      redis,
    );

    await expect(
      cooldownOrchestrator.execute({
        userId: "user-123",
        userPrompt: "first quota request",
      }),
    ).rejects.toThrow("AI Request failed");
    await expect(
      cooldownOrchestrator.execute({
        userId: "user-123",
        userPrompt: "second request during cooldown",
      }),
    ).rejects.toThrow("quota cooldown is active");

    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(historyLog).toHaveBeenCalledTimes(1);
  });

  it("opens a short availability circuit after a provider 503", async () => {
    const chatMock = vi.fn().mockRejectedValue(
      Object.assign(new Error("Provider unavailable"), {
        status: 503,
        providerRequestSent: true,
      }),
    );
    const provider = {
      providerType: "OPENAI",
      chat: chatMock as LLMProvider["chat"],
    } as unknown as LLMProvider;
    const factoryWithStub = {
      getProvider: () => provider,
    } as unknown as LLMProviderFactory;
    const baseConfig = await mockConfigService.getOrCreateConfig("user-123");
    const noFallbackConfig = {
      getOrCreateConfig: () =>
        Promise.resolve({
          ...baseConfig,
          preferredProvider: "OPENAI" as const,
          fallbackEnabled: false,
          fallbackProviders: [],
        }),
    } as unknown as AIConfigService;
    const unavailableOrchestrator = new AIOrchestratorService(
      noFallbackConfig,
      mockBudgetManager,
      contextBuilder,
      promptEngine,
      factoryWithStub,
      mockHistoryService,
      new CostEstimatorService(modelRegistry),
    );

    await expect(
      unavailableOrchestrator.execute({
        userId: "user-123",
        userPrompt: "first unavailable request",
      }),
    ).rejects.toMatchObject({ status: 503, code: "ALL_MODELS_UNAVAILABLE" });
    await expect(
      unavailableOrchestrator.execute({
        userId: "user-123",
        userPrompt: "second request during outage",
      }),
    ).rejects.toMatchObject({ status: 503, code: "ALL_MODELS_UNAVAILABLE" });

    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("should reuse a cached response for the same prompt", async () => {
    const chatMock = vi.fn().mockResolvedValue({
      text: "cached analysis",
      json: null,
      finishReason: "stop",
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        estimatedCost: 0.01,
      },
      latencyMs: 100,
      provider: "OPENAI" as const,
      model: "gpt-5-mini",
    });
    const provider = {
      providerType: "OPENAI",
      chat: chatMock as LLMProvider["chat"],
      stream: async function* () {
        await Promise.resolve();
        yield { deltaToken: "", isComplete: true };
      } as LLMProvider["stream"],
      embedding: vi.fn(),
      countTokens: vi.fn(),
      health: vi.fn(),
      listModels: vi.fn(),
    } as unknown as LLMProvider;

    const factoryWithStub = {
      getProvider: () => provider,
    } as unknown as LLMProviderFactory;

    const cachedOrchestrator = new AIOrchestratorService(
      mockConfigService,
      mockBudgetManager,
      contextBuilder,
      promptEngine,
      factoryWithStub,
      mockHistoryService,
      new CostEstimatorService(modelRegistry),
      mockRedisService,
    );

    const first = await cachedOrchestrator.execute({
      userId: "user-123",
      userPrompt: "Analyze BTC trend",
      provider: "OPENAI",
    });

    const second = await cachedOrchestrator.execute({
      userId: "user-123",
      userPrompt: "Analyze BTC trend",
      provider: "OPENAI",
    });

    expect(first.text).toBe("cached analysis");
    expect(second.text).toBe("cached analysis");
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it("should stream tokens chunk by chunk", async () => {
    const stream = orchestrator.stream({
      userId: "user-123",
      userPrompt: "Stream BTC test",
    });

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[chunks.length - 1]?.isComplete).toBe(true);
  });
});
