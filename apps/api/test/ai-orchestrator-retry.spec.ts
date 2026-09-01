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
import type {
  LLMProvider,
  LLMRequestOptions,
  LLMResponse,
  LLMStreamChunk,
} from "../src/modules/ai/domain/interfaces/llm-provider.interface";
import type { AIProviderType } from "@platform/shared";
import type { RedisService } from "../src/redis/redis.service";

describe("AIOrchestratorService - Retry & Stream Fallback", () => {
  interface CreateTestOrchestratorOptions {
    primaryProviderChat?: (options: LLMRequestOptions) => Promise<LLMResponse>;
    primaryProviderStream?: (options: LLMRequestOptions) => AsyncIterable<LLMStreamChunk>;
    fallbackProviderChat?: (options: LLMRequestOptions) => Promise<LLMResponse>;
    fallbackProviderStream?: (options: LLMRequestOptions) => AsyncIterable<LLMStreamChunk>;
    fallbackEnabled?: boolean;
    fallbackProviders?: AIProviderType[];
  }

  function createTestOrchestrator(opts: CreateTestOrchestratorOptions = {}) {
    const modelRegistry = new ModelRegistryService();
    const promptEngine = new PromptEngineService(new PromptRegistry(), new PromptRenderer());
    const contextBuilder = new ContextBuilderService(new ContextCompressor());

    const mockConfigService = {
      getOrCreateConfig: () =>
        Promise.resolve({
          id: "cfg-1",
          userId: "user-123",
          preferredProvider: "OPENAI" as const,
          preferredModel: "gpt-5-mini",
          temperature: 0,
          maxTokens: 2048,
          timeoutMs: 5000,
          dailyBudget: 10,
          monthlyBudget: 100,
          tokenBudget: 1000000,
          requestBudget: 1000,
          fallbackEnabled: opts.fallbackEnabled ?? false,
          fallbackProviders: opts.fallbackProviders ?? [],
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

    const defaultChat = vi.fn().mockResolvedValue({
      text: "ok response",
      json: null,
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCost: 0.01 },
      latencyMs: 100,
      provider: "OPENAI" as const,
      model: "gpt-5-mini",
    });

    const defaultStream = async function* () {
      await Promise.resolve();
      yield { deltaToken: "chunk1", isComplete: false };
      yield { deltaToken: "chunk2", isComplete: true };
    };

    const primaryProvider: LLMProvider = {
      providerType: "OPENAI",
      chat: opts.primaryProviderChat || defaultChat,
      stream: opts.primaryProviderStream || defaultStream,
      embedding: vi.fn(),
      countTokens: vi.fn(),
      health: vi.fn(),
      listModels: vi.fn(),
    } as unknown as LLMProvider;

    const fallbackProvider: LLMProvider = {
      providerType: "ANTHROPIC",
      chat: opts.fallbackProviderChat || defaultChat,
      stream: opts.fallbackProviderStream || defaultStream,
      embedding: vi.fn(),
      countTokens: vi.fn(),
      health: vi.fn(),
      listModels: vi.fn(),
    } as unknown as LLMProvider;

    const providerFactory = {
      getProvider: (type: AIProviderType) => {
        if (type === "ANTHROPIC") return fallbackProvider;
        return primaryProvider;
      },
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
      providerFactory,
      mockHistoryService,
      new CostEstimatorService(modelRegistry),
      mockRedisService,
    );

    return { orchestrator, primaryProvider, fallbackProvider };
  }

  describe("executeWithRetry via execute()", () => {
    it("should retry once on 503 transient error and succeed on 2nd attempt with default maxRetries=1", async () => {
      let callCount = 0;
      const chatMock = vi.fn().mockImplementation(async () => {
        await Promise.resolve();
        callCount++;
        if (callCount === 1) {
          const err = new Error("503 Service Unavailable");
          Object.assign(err, { status: 503 });
          throw err;
        }
        return {
          text: "success on retry",
          json: null,
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCost: 0.01 },
          latencyMs: 50,
          provider: "OPENAI" as const,
          model: "gpt-5-mini",
        };
      });

      const { orchestrator } = createTestOrchestrator({
        primaryProviderChat: chatMock,
      });

      const res = await orchestrator.execute({
        userId: "user-123",
        userPrompt: "Test transient retry",
        provider: "OPENAI",
      });

      expect(callCount).toBe(2);
      expect(res.text).toBe("success on retry");
    });

    it("should not retry on non-retryable 400 Bad Request error", async () => {
      let callCount = 0;
      const chatMock = vi.fn().mockImplementation(async () => {
        await Promise.resolve();
        callCount++;
        const err = new Error("400 Bad Request");
        Object.assign(err, { status: 400 });
        throw err;
      });

      const { orchestrator } = createTestOrchestrator({
        primaryProviderChat: chatMock,
      });

      await expect(
        orchestrator.execute({
          userId: "user-123",
          userPrompt: "Test 400 error",
          provider: "OPENAI",
        }),
      ).rejects.toThrow("400 Bad Request");

      expect(callCount).toBe(1);
    });

    it("should not retry on non-retryable 401 Unauthorized error", async () => {
      let callCount = 0;
      const chatMock = vi.fn().mockImplementation(async () => {
        await Promise.resolve();
        callCount++;
        const err = new Error("401 Unauthorized");
        Object.assign(err, { status: 401 });
        throw err;
      });

      const { orchestrator } = createTestOrchestrator({
        primaryProviderChat: chatMock,
      });

      await expect(
        orchestrator.execute({
          userId: "user-123",
          userPrompt: "Test 401 error",
          provider: "OPENAI",
        }),
      ).rejects.toThrow();

      expect(callCount).toBe(1);
    });

    it("should throw after exceeding default maxRetries (1 retry = 2 attempts total)", async () => {
      let callCount = 0;
      const chatMock = vi.fn().mockImplementation(async () => {
        await Promise.resolve();
        callCount++;
        const err = new Error("500 Internal Server Error");
        Object.assign(err, { status: 500 });
        throw err;
      });

      const { orchestrator } = createTestOrchestrator({
        primaryProviderChat: chatMock,
      });

      await expect(
        orchestrator.execute({
          userId: "user-123",
          userPrompt: "Test persistent error",
          provider: "OPENAI",
        }),
      ).rejects.toThrow();

      // 1 initial + 1 retry = 2 calls
      expect(callCount).toBe(2);
    });
  });

  describe("stream fallback", () => {
    it("should stream successfully from primary provider when primary works", async () => {
      const { orchestrator } = createTestOrchestrator();

      const chunks: LLMStreamChunk[] = [];
      for await (const chunk of orchestrator.stream({
        userId: "user-123",
        userPrompt: "Stream test",
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(2);
      expect(chunks[0]?.deltaToken).toBe("chunk1");
      expect(chunks[1]?.deltaToken).toBe("chunk2");
      expect(chunks[1]?.isComplete).toBe(true);
    });

    it("should fallback to secondary provider when primary provider stream fails", async () => {
      const primaryStreamMock = vi.fn().mockImplementation(async function* () {
        await Promise.resolve();
        throw new Error("Primary stream connection failed");
        yield { deltaToken: "never", isComplete: false };
      });

      const fallbackStreamMock = vi.fn().mockImplementation(async function* () {
        await Promise.resolve();
        yield { deltaToken: "fallback chunk", isComplete: true };
      });

      const { orchestrator } = createTestOrchestrator({
        primaryProviderStream: primaryStreamMock,
        fallbackProviderStream: fallbackStreamMock,
        fallbackEnabled: true,
        fallbackProviders: ["ANTHROPIC"],
      });

      const chunks: LLMStreamChunk[] = [];
      for await (const chunk of orchestrator.stream({
        userId: "user-123",
        userPrompt: "Stream test with fallback",
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(chunks[0]?.deltaToken).toBe("fallback chunk");
      expect(chunks[0]?.isComplete).toBe(true);
    });

    it("should throw when all providers fail for stream request", async () => {
      const primaryStreamMock = vi.fn().mockImplementation(async function* () {
        await Promise.resolve();
        throw new Error("Primary stream failed");
        yield { deltaToken: "never", isComplete: false };
      });

      const fallbackStreamMock = vi.fn().mockImplementation(async function* () {
        await Promise.resolve();
        throw new Error("Fallback stream failed");
        yield { deltaToken: "never", isComplete: false };
      });

      const { orchestrator } = createTestOrchestrator({
        primaryProviderStream: primaryStreamMock,
        fallbackProviderStream: fallbackStreamMock,
        fallbackEnabled: true,
        fallbackProviders: ["ANTHROPIC"],
      });

      const iterator = orchestrator.stream({
        userId: "user-123",
        userPrompt: "Stream test all failing",
      });

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of iterator) {
          // should throw
        }
      }).rejects.toThrow("All providers failed for stream request");
    });

    it("should re-throw and not fallback if primary provider fails after yielding chunks", async () => {
      const primaryStreamMock = vi.fn().mockImplementation(async function* () {
        await Promise.resolve();
        yield { deltaToken: "chunk1", isComplete: false };
        throw new Error("Primary stream connection dropped mid-stream");
      });

      const fallbackStreamMock = vi.fn().mockImplementation(async function* () {
        await Promise.resolve();
        yield { deltaToken: "fallback chunk", isComplete: true };
      });

      const { orchestrator } = createTestOrchestrator({
        primaryProviderStream: primaryStreamMock,
        fallbackProviderStream: fallbackStreamMock,
        fallbackEnabled: true,
        fallbackProviders: ["ANTHROPIC"],
      });

      const iterator = orchestrator.stream({
        userId: "user-123",
        userPrompt: "Stream test with mid-stream failure",
      });

      const chunks = [];
      await expect(async () => {
        for await (const chunk of iterator) {
          chunks.push(chunk);
        }
      }).rejects.toThrow("Primary stream connection dropped mid-stream");

      expect(chunks.length).toBe(1);
      expect(chunks[0]?.deltaToken).toBe("chunk1");
    });
  });
});
