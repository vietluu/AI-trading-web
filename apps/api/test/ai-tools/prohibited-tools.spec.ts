import { describe, expect, it } from "vitest";
import { ToolRegistryService } from "../../src/modules/ai-tools/infrastructure/registry/tool-registry.service";
import { OpenAIToolSchemaMapper } from "../../src/modules/ai-tools/infrastructure/mappers/openai-tool-schema.mapper";
import { AnthropicToolSchemaMapper } from "../../src/modules/ai-tools/infrastructure/mappers/anthropic-tool-schema.mapper";
import { GeminiToolSchemaMapper } from "../../src/modules/ai-tools/infrastructure/mappers/gemini-tool-schema.mapper";
import { OllamaToolSchemaMapper } from "../../src/modules/ai-tools/infrastructure/mappers/ollama-tool-schema.mapper";

describe("Security Audit: Prohibited Tools Check", () => {
  const registry = new ToolRegistryService(
    new OpenAIToolSchemaMapper(),
    new AnthropicToolSchemaMapper(),
    new GeminiToolSchemaMapper(),
    new OllamaToolSchemaMapper()
  );

  const prohibitedToolNames = [
    "exchange.order.create",
    "exchange.order.cancel",
    "exchange.position.close",
    "exchange.position.reduce",
    "exchange.leverage.set",
    "exchange.margin_mode.set",
    "trading.paper_order.create",
    "trading.live_order.create",
    "user.credential.get_secret",
    "system.sql.execute",
    "system.shell.execute",
    "system.http.request",
    "system.file.read",
    "system.file.write",
    "system.environment.get",
    "system.process.execute",
  ];

  it("must NEVER register any prohibited side-effecting, order placement, or shell tools", () => {
    const registeredTools = registry.list().map((t) => t.name);

    for (const prohibited of prohibitedToolNames) {
      expect(registeredTools).not.toContain(prohibited);
      expect(registry.resolveByName(prohibited)).toBeUndefined();
    }
  });
});
