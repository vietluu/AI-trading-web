import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { ModelRegistryService } from "../../src/modules/ai/infrastructure/registry/model-registry.service";
import { OpenAIProvider } from "../../src/modules/ai/infrastructure/provider/openai.provider";
import { AnthropicProvider } from "../../src/modules/ai/infrastructure/provider/anthropic.provider";
import { GeminiProvider } from "../../src/modules/ai/infrastructure/provider/gemini.provider";
import { OllamaProvider } from "../../src/modules/ai/infrastructure/provider/ollama.provider";
import { LLMProviderFactory } from "../../src/modules/ai/infrastructure/provider/llm-provider.factory";

describe("AI Providers & LLMProviderFactory", () => {
  let modelRegistry: ModelRegistryService;
  let openAIProvider: OpenAIProvider;
  let anthropicProvider: AnthropicProvider;
  let geminiProvider: GeminiProvider;
  let ollamaProvider: OllamaProvider;
  let factory: LLMProviderFactory;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    const mockConfig = { get: () => undefined } as unknown as ConfigService;
    modelRegistry = new ModelRegistryService();
    openAIProvider = new OpenAIProvider(mockConfig, modelRegistry);
    anthropicProvider = new AnthropicProvider(mockConfig, modelRegistry);
    geminiProvider = new GeminiProvider(mockConfig, modelRegistry);
    ollamaProvider = new OllamaProvider(mockConfig, modelRegistry);

    factory = new LLMProviderFactory(
      openAIProvider,
      anthropicProvider,
      geminiProvider,
      ollamaProvider
    );
  });

  it("should return correct provider implementation from factory", () => {
    expect(factory.getProvider("OPENAI")).toBe(openAIProvider);
    expect(factory.getProvider("ANTHROPIC")).toBe(anthropicProvider);
    expect(factory.getProvider("GEMINI")).toBe(geminiProvider);
    expect(factory.getProvider("OLLAMA")).toBe(ollamaProvider);
  });

  it("should execute mock chat for OpenAIProvider when API key is unconfigured or in test mode", async () => {
    process.env.MOCK_AI_RESPONSES = "true";
    const res = await openAIProvider.chat({
      model: "gpt-5-mini",
      userPrompt: "Test futures BTC prompt",
    });
    expect(res.provider).toBe("OPENAI");
    expect(res.text).toBeDefined();
    expect(res.usage.totalTokens).toBeGreaterThan(0);
  });

  it("should execute mock chat for AnthropicProvider", async () => {
    process.env.MOCK_AI_RESPONSES = "true";
    const res = await anthropicProvider.chat({
      model: "claude-3-5-sonnet-20241022",
      userPrompt: "Test Claude prompt",
    });
    expect(res.provider).toBe("ANTHROPIC");
    expect(res.finishReason).toBe("end_turn");
  });

  it("should report NOT_CONFIGURED or HEALTHY status on provider health checks", async () => {
    const openAiHealth = await openAIProvider.health();
    expect(openAiHealth.provider).toBe("OPENAI");
    expect(openAiHealth.models.length).toBeGreaterThan(0);
  });

  it("opens a quota circuit and prevents queued Gemini calls after the first 429", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalMockResponses = process.env.MOCK_AI_RESPONSES;
    process.env.NODE_ENV = "production";
    delete process.env.MOCK_AI_RESPONSES;
    try {
      const config = {
        get: (key: string) => {
          if (key === "GOOGLE_API_KEY") return "test-key";
          if (key === "GEMINI_MAX_CONCURRENCY") return "1";
          if (key === "GEMINI_429_COOLDOWN_MS") return "60000";
          return undefined;
        },
      } as unknown as ConfigService;
      const provider = new GeminiProvider(config, modelRegistry);
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('{"error":{"code":429,"message":"quota exceeded"}}', {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const results = await Promise.allSettled([
        provider.chat({ model: "gemini-test", userPrompt: "one" }),
        provider.chat({ model: "gemini-test", userPrompt: "two" }),
        provider.chat({ model: "gemini-test", userPrompt: "three" }),
      ]);

      expect(results.every((result) => result.status === "rejected")).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const queuedError = (results[1] as PromiseRejectedResult).reason as Error & {
        providerRequestSent?: boolean;
      };
      expect(queuedError.providerRequestSent).toBe(false);
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalMockResponses === undefined) delete process.env.MOCK_AI_RESPONSES;
      else process.env.MOCK_AI_RESPONSES = originalMockResponses;
    }
  });
});
