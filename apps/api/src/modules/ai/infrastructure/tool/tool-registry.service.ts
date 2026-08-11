import { Injectable, Logger } from "@nestjs/common";

export interface ToolDefinition {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  category?: string;
}

export type ToolHandler = (params: Record<string, unknown>) => Promise<Record<string, unknown>>;

export interface Tool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, Tool>();

  constructor() {
    this.registerDefaultTools();
  }

  private registerDefaultTools(): void {
    this.registerTool({
      definition: {
        name: "get_market_price",
        description: "Fetch current spot and futures ticker price for a cryptocurrency symbol",
        parametersSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Symbol name e.g. BTC-USDT" },
          },
          required: ["symbol"],
        },
        category: "market",
      },
      handler: (params) => {
        const symbol = typeof params["symbol"] === "string" ? params["symbol"] : undefined;
        if (!symbol) return Promise.reject(new Error("SYMBOL_REQUIRED"));
        return Promise.reject(new Error(`LEGACY_SYNTHETIC_TOOL_DISABLED: use market.ticker.get for ${symbol}`));
      },
    });

    this.registerTool({
      definition: {
        name: "get_indicator_snapshot",
        description: "Fetch technical indicator snapshot (RSI, EMA, MACD) for a symbol",
        parametersSchema: {
          type: "object",
          properties: {
            symbol: { type: "string" },
            timeframe: { type: "string" },
          },
          required: ["symbol"],
        },
        category: "technical",
      },
      handler: (params) => {
        if (typeof params["symbol"] !== "string") return Promise.reject(new Error("SYMBOL_REQUIRED"));
        return Promise.reject(new Error("LEGACY_SYNTHETIC_TOOL_DISABLED: use market.indicators.get"));
      },
    });
  }

  public registerTool(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
    this.logger.log(`Registered tool: ${tool.definition.name}`);
  }

  public getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  public listTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  public validate(name: string, params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const tool = this.getTool(name);
    if (!tool) {
      return { valid: false, errors: [`Tool '${name}' is not registered`] };
    }
    const reqProps = (tool.definition.parametersSchema.required as string[]) || [];
    const missing = reqProps.filter((p) => !(p in params));
    if (missing.length > 0) {
      return { valid: false, errors: [`Missing required tool parameters: ${missing.join(", ")}`] };
    }
    return { valid: true };
  }
}
