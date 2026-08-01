import { describe, expect, it } from "vitest";
import { OpenAIToolSchemaMapper } from "../../src/modules/ai-tools/infrastructure/mappers/openai-tool-schema.mapper";
import { AnthropicToolSchemaMapper } from "../../src/modules/ai-tools/infrastructure/mappers/anthropic-tool-schema.mapper";
import { GeminiToolSchemaMapper } from "../../src/modules/ai-tools/infrastructure/mappers/gemini-tool-schema.mapper";
import { OllamaToolSchemaMapper } from "../../src/modules/ai-tools/infrastructure/mappers/ollama-tool-schema.mapper";
import type { CanonicalToolSchema } from "../../src/modules/ai-tools/domain/contracts/provider-schema.contract";

describe("Provider Tool Schema Mappers", () => {
  const canonicalSchema: CanonicalToolSchema = {
    name: "market.ticker.get",
    description: "Get spot ticker",
    inputJsonSchema: {
      type: "object",
      properties: { symbol: { type: "string" } },
    },
    strict: true,
  };

  it("should map canonical schema to OpenAI tool format", () => {
    const mapper = new OpenAIToolSchemaMapper();
    const mapped = mapper.mapSchema(canonicalSchema);

    expect(mapped.type).toBe("function");
    expect(mapped.function.name).toBe("market_ticker_get");
    expect(mapped.function.description).toBe("Get spot ticker");
  });

  it("should map canonical schema to Anthropic input_schema format", () => {
    const mapper = new AnthropicToolSchemaMapper();
    const mapped = mapper.mapSchema(canonicalSchema);

    expect(mapped.name).toBe("market_ticker_get");
    expect(mapped.input_schema).toBeDefined();
  });

  it("should map canonical schema to Gemini functionDeclaration format", () => {
    const mapper = new GeminiToolSchemaMapper();
    const mapped = mapper.mapSchema(canonicalSchema);

    expect(mapped.name).toBe("market_ticker_get");
    expect(mapped.parameters).toBeDefined();
  });

  it("should map canonical schema to Ollama tool format", () => {
    const mapper = new OllamaToolSchemaMapper();
    const mapped = mapper.mapSchema(canonicalSchema);

    expect(mapped.type).toBe("function");
    expect(mapped.function.name).toBe("market_ticker_get");
  });
});
