import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type {
  AIProviderType,
  ToolCapability,
  ToolCategory,
  ToolHealthDto,
} from "@platform/shared";
import type { ToolDefinition } from "../../domain/contracts/tool-definition.contract";
import type { CanonicalToolSchema } from "../../domain/contracts/provider-schema.contract";
import { OpenAIToolSchemaMapper } from "../mappers/openai-tool-schema.mapper";
import { AnthropicToolSchemaMapper } from "../mappers/anthropic-tool-schema.mapper";
import { GeminiToolSchemaMapper } from "../mappers/gemini-tool-schema.mapper";
import { OllamaToolSchemaMapper } from "../mappers/ollama-tool-schema.mapper";

@Injectable()
export class ToolRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();
  private readonly healthMap = new Map<
    string,
    { lastInvocationAt?: Date; errorCount: number; successCount: number; totalLatencyMs: number; lastError?: string }
  >();

  constructor(
    private readonly openAIMapper: OpenAIToolSchemaMapper,
    private readonly anthropicMapper: AnthropicToolSchemaMapper,
    private readonly geminiMapper: GeminiToolSchemaMapper,
    private readonly ollamaMapper: OllamaToolSchemaMapper
  ) {}

  public onModuleInit(): void {
    this.logger.log(`Initialized ToolRegistryService with ${this.tools.size} registered tools.`);
  }

  public register(tool: ToolDefinition<unknown, unknown>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool registration rejected: Tool with name '${tool.name}' is already registered.`);
    }

    if (
      tool.sideEffect === "USER_STATE_WRITE" ||
      tool.sideEffect === "FINANCIAL_WRITE" ||
      tool.sideEffect === "SYSTEM_WRITE"
    ) {
      throw new Error(`Tool registration rejected: Side-effect '${tool.sideEffect}' is prohibited for AI tools in Phase 6.2.`);
    }

    this.tools.set(tool.name, tool);
    this.healthMap.set(tool.name, { errorCount: 0, successCount: 0, totalLatencyMs: 0 });
    this.logger.log(`Successfully registered AI tool: ${tool.name} (v${tool.version}) [Category: ${tool.category}]`);
  }

  public unregister(name: string): boolean {
    const deleted = this.tools.delete(name);
    if (deleted) {
      this.healthMap.delete(name);
    }
    return deleted;
  }

  public resolveByName(name: string): ToolDefinition<unknown, unknown> | undefined {
    const canonicalName = name.replace(/_/g, ".");
    return this.tools.get(canonicalName) || this.tools.get(name);
  }

  public list(): ToolDefinition<unknown, unknown>[] {
    return Array.from(this.tools.values());
  }

  public listByCategory(category: ToolCategory): ToolDefinition<unknown, unknown>[] {
    return this.list().filter((t) => t.category === category);
  }

  public listByAgentType(agentType: string): ToolDefinition<unknown, unknown>[] {
    return this.list().filter(
      (t) => t.allowedAgentTypes.includes("*") || t.allowedAgentTypes.includes(agentType)
    );
  }

  public listByCapability(capability: ToolCapability): ToolDefinition<unknown, unknown>[] {
    return this.list().filter((t) => t.requiredCapabilities.includes(capability));
  }

  public recordHealthTelemetry(name: string, durationMs: number, success: boolean, errorMsg?: string): void {
    const h = this.healthMap.get(name) || { errorCount: 0, successCount: 0, totalLatencyMs: 0 };
    h.lastInvocationAt = new Date();
    h.totalLatencyMs += durationMs;
    if (success) {
      h.successCount++;
    } else {
      h.errorCount++;
      if (errorMsg) h.lastError = errorMsg;
    }
    this.healthMap.set(name, h);
  }

  public getHealth(): ToolHealthDto[] {
    return this.list().map((t) => {
      const h = this.healthMap.get(t.name) || { errorCount: 0, successCount: 0, totalLatencyMs: 0 };
      const totalRuns = h.successCount + h.errorCount;
      const successRatePct = totalRuns > 0 ? (h.successCount / totalRuns) * 100 : 100;
      const averageLatencyMs = totalRuns > 0 ? Math.round(h.totalLatencyMs / totalRuns) : 0;

      return {
        name: t.name,
        version: t.version,
        status: t.status,
        category: t.category,
        averageLatencyMs,
        successRatePct: Number(successRatePct.toFixed(1)),
        lastInvocationAt: h.lastInvocationAt ? h.lastInvocationAt.toISOString() : null,
        lastError: h.lastError || null,
      };
    });
  }

  public getCanonicalSchema(tool: ToolDefinition<unknown, unknown>): CanonicalToolSchema {
    const shape = (tool.inputSchema as unknown as { _def?: { shape?: Record<string, unknown> } })._def?.shape || {};

    return {
      name: tool.name,
      description: tool.description,
      inputJsonSchema: {
        type: "object",
        properties: this.zodShapeToJsonSchema(shape),
      },
      strict: true,
    };
  }

  public getProviderSchemas(
    provider: AIProviderType,
    allowedCapabilities?: ToolCapability[],
    allowedToolNames?: string[],
  ): unknown[] {
    const activeTools = this.list().filter((t) => t.status === "ACTIVE" || t.status === "EXPERIMENTAL");
    let filteredTools = allowedCapabilities
      ? activeTools.filter((t) => t.requiredCapabilities.every((c) => allowedCapabilities.includes(c)))
      : activeTools;
    if (allowedToolNames) {
      const allowed = new Set(allowedToolNames);
      filteredTools = filteredTools.filter((tool) => allowed.has(tool.name));
    }

    return filteredTools.map((t) => {
      const canonical = this.getCanonicalSchema(t);
      switch (provider) {
        case "OPENAI":
          return this.openAIMapper.mapSchema(canonical);
        case "ANTHROPIC":
          return this.anthropicMapper.mapSchema(canonical);
        case "GEMINI":
          return this.geminiMapper.mapSchema(canonical);
        case "OLLAMA":
          return this.ollamaMapper.mapSchema(canonical);
        default:
          return this.openAIMapper.mapSchema(canonical);
      }
    });
  }

  private zodShapeToJsonSchema(shape: Record<string, unknown>): Record<string, unknown> {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(shape)) {
      const fieldDef = (val as { _def?: { typeName?: string; description?: string; values?: string[] } })._def;
      const typeName = fieldDef?.typeName;

      if (typeName === "ZodString") {
        props[key] = { type: "string", description: fieldDef?.description || key };
      } else if (typeName === "ZodNumber") {
        props[key] = { type: "number", description: fieldDef?.description || key };
      } else if (typeName === "ZodBoolean") {
        props[key] = { type: "boolean", description: fieldDef?.description || key };
      } else if (typeName === "ZodEnum") {
        props[key] = { type: "string", enum: fieldDef?.values || [], description: key };
      } else {
        props[key] = { type: "string", description: key };
      }
    }
    return props;
  }
}
