import { describe, expect, it, beforeEach } from "vitest";
import { PromptRegistry } from "../../src/modules/ai/infrastructure/prompt/prompt-registry";
import { PromptRenderer } from "../../src/modules/ai/infrastructure/prompt/prompt-renderer";
import { PromptEngineService } from "../../src/modules/ai/infrastructure/prompt/prompt-engine.service";
import { ContextCompressor } from "../../src/modules/ai/infrastructure/context/context-compressor";
import { ContextBuilderService } from "../../src/modules/ai/infrastructure/context/context-builder.service";
import { TokenCounterService } from "../../src/modules/ai/infrastructure/token/token-counter.service";
import { ToolRegistryService } from "../../src/modules/ai/infrastructure/tool/tool-registry.service";
import { ToolExecutorService } from "../../src/modules/ai/infrastructure/tool/tool-executor.service";

describe("AI Core Components (Prompt, Context, Token, Tool)", () => {
  let promptRegistry: PromptRegistry;
  let promptRenderer: PromptRenderer;
  let promptEngine: PromptEngineService;
  let contextCompressor: ContextCompressor;
  let contextBuilder: ContextBuilderService;
  let tokenCounter: TokenCounterService;
  let toolRegistry: ToolRegistryService;
  let toolExecutor: ToolExecutorService;

  beforeEach(() => {
    promptRegistry = new PromptRegistry();
    promptRenderer = new PromptRenderer();
    promptEngine = new PromptEngineService(promptRegistry, promptRenderer);
    contextCompressor = new ContextCompressor();
    contextBuilder = new ContextBuilderService(contextCompressor);
    tokenCounter = new TokenCounterService();
    toolRegistry = new ToolRegistryService();
    toolExecutor = new ToolExecutorService(toolRegistry);
  });

  describe("Prompt Engine", () => {
    it("should render registered prompt template with version and variables", () => {
      const rendered = promptEngine.render("market-analysis-v1", {
        user: { rsi: 65, macd: 120 },
        system: { symbol: "BTC-USDT", interval: "1h" },
      });

      expect(rendered.templateId).toBe("market-analysis-v1");
      expect(rendered.systemPrompt).toContain("BTC-USDT");
      expect(rendered.userPrompt).toContain("RSI (65)");
      expect(rendered.fullPrompt).toContain("[SYSTEM]");
    });

    it("should render direct prompt when template ID is not found", () => {
      const rendered = promptEngine.renderDirect({
        userPrompt: "Analyze ETH funding rates",
        systemPrompt: "Crypto research bot",
      });

      expect(rendered.userPrompt).toBe("Analyze ETH funding rates");
      expect(rendered.fullPrompt).toContain("ETH funding rates");
    });
  });

  describe("Context Builder & Compressor", () => {
    it("should aggregate sources and compress context within token limit", () => {
      const { contextString, totalTokens } = contextBuilder.buildContext(
        {
          riskSettings: { maxLeverage: 10, maxExposureUsd: 5000 },
          marketData: { symbol: "BTC-USDT", lastPrice: 95400 },
          indicators: { rsi14: 62 },
        },
        500
      );

      expect(contextString).toContain("Risk Settings");
      expect(contextString).toContain("Market Data");
      expect(totalTokens).toBeGreaterThan(0);
      expect(totalTokens).toBeLessThanOrEqual(500);
    });

    it("should deduplicate context items with identical content", () => {
      const item1 = { id: "1", source: "A", priority: 1, content: "duplicate data", tokens: 10 };
      const item2 = { id: "2", source: "B", priority: 2, content: "duplicate data", tokens: 10 };
      const deduped = contextCompressor.deduplicate([item1, item2]);
      expect(deduped.length).toBe(1);
    });
  });

  describe("Token Counter", () => {
    it("should estimate input, prompt, and context tokens accurately", () => {
      const breakdown = tokenCounter.estimateBreakdown({
        userPrompt: "What is the leverage risk?",
        systemPrompt: "You are a risk engine analyst.",
        context: "Position size: $10,000",
      });

      expect(breakdown.promptTokens).toBeGreaterThan(0);
      expect(breakdown.systemTokens).toBeGreaterThan(0);
      expect(breakdown.contextTokens).toBeGreaterThan(0);
      expect(breakdown.totalTokens).toBe(breakdown.totalInputTokens + breakdown.estimatedOutputTokens);
    });
  });

  describe("Tool Registry & Executor", () => {
    it("should list default registered tools and execute get_market_price tool", async () => {
      const tools = toolRegistry.listTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === "get_market_price")).toBe(true);

      const execResult = await toolExecutor.execute("get_market_price", { symbol: "BTC-USDT" });
      expect(execResult.success).toBe(true);
      expect(execResult.result?.symbol).toBe("BTC-USDT");
      expect(execResult.result?.price).toBeDefined();
    });

    it("should fail validation when required parameters are missing", async () => {
      const execResult = await toolExecutor.execute("get_market_price", {});
      expect(execResult.success).toBe(false);
      expect(execResult.error).toContain("Missing required tool parameters");
    });
  });
});
