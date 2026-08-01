import { Injectable, Logger } from "@nestjs/common";
import { ToolRegistryService } from "./tool-registry.service";

@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  constructor(private readonly registry: ToolRegistryService) {}

  public async execute(name: string, params: Record<string, unknown>): Promise<{ success: boolean; result?: Record<string, unknown>; error?: string }> {
    const validation = this.registry.validate(name, params);
    if (!validation.valid) {
      return { success: false, error: validation.errors?.join("; ") };
    }

    const tool = this.registry.getTool(name);
    if (!tool) {
      return { success: false, error: `Tool ${name} not found` };
    }

    try {
      const result = await tool.handler(params);
      return { success: true, result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Tool execution error for '${name}': ${msg}`);
      return { success: false, error: msg };
    }
  }
}
