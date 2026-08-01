import { describe, expect, it, beforeEach } from "vitest";
import { ToolRegistryService } from "../../src/modules/ai-tools/infrastructure/registry/tool-registry.service";
import { OpenAIToolSchemaMapper } from "../../src/modules/ai-tools/infrastructure/mappers/openai-tool-schema.mapper";
import { AnthropicToolSchemaMapper } from "../../src/modules/ai-tools/infrastructure/mappers/anthropic-tool-schema.mapper";
import { GeminiToolSchemaMapper } from "../../src/modules/ai-tools/infrastructure/mappers/gemini-tool-schema.mapper";
import { OllamaToolSchemaMapper } from "../../src/modules/ai-tools/infrastructure/mappers/ollama-tool-schema.mapper";
import { MarketTickerGetTool, MarketCandlesListTool } from "../../src/modules/ai-tools/infrastructure/tools/market-tools";

describe("Tool Registry & Definition", () => {
  let registry: ToolRegistryService;

  beforeEach(() => {
    registry = new ToolRegistryService(
      new OpenAIToolSchemaMapper(),
      new AnthropicToolSchemaMapper(),
      new GeminiToolSchemaMapper(),
      new OllamaToolSchemaMapper()
    );
  });

  it("should register and resolve safe read-only tools", () => {
    const tickerTool = new MarketTickerGetTool();
    registry.register(tickerTool);

    const resolved = registry.resolveByName("market.ticker.get");
    expect(resolved).toBeDefined();
    expect(resolved?.name).toBe("market.ticker.get");
    expect(resolved?.category).toBe("MARKET_DATA");
  });

  it("should reject duplicate tool registrations", () => {
    const tickerTool = new MarketTickerGetTool();
    registry.register(tickerTool);

    expect(() => registry.register(tickerTool)).toThrow("is already registered");
  });

  it("should filter tools by category and capability", () => {
    registry.register(new MarketTickerGetTool());
    registry.register(new MarketCandlesListTool());

    const marketTools = registry.listByCategory("MARKET_DATA");
    expect(marketTools.length).toBe(2);

    const capTools = registry.listByCapability("READ_MARKET_DATA");
    expect(capTools.length).toBe(2);
  });
});
