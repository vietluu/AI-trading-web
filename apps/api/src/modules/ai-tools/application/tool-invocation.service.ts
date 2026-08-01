import { Injectable, Logger } from "@nestjs/common";
import { ToolExecutorService } from "../infrastructure/executors/tool-executor.service";
import { ToolRegistryService } from "../infrastructure/registry/tool-registry.service";
import { ToolInvocationRepository } from "../infrastructure/persistence/tool-invocation.repository";
import type { ToolResult } from "../domain/contracts/tool-result.contract";
import type { ToolExecutionContext } from "../domain/contracts/tool-context.contract";

@Injectable()
export class ToolInvocationService {
  private readonly logger = new Logger(ToolInvocationService.name);

  constructor(
    private readonly executor: ToolExecutorService,
    private readonly registry: ToolRegistryService,
    private readonly repository: ToolInvocationRepository
  ) {}

  public async invokeTool(toolName: string, rawArgs: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    this.logger.log(`Invoking tool '${toolName}' (Invocation ID: ${context.invocationId}, User ID: ${context.userId || "anonymous"})`);
    return this.executor.execute(toolName, rawArgs, context);
  }

  public async getHistory(userId?: string, limit = 50, toolName?: string) {
    return this.repository.getHistory(userId, limit, toolName);
  }

  public listTools() {
    return this.registry.list().map((t) => ({
      name: t.name,
      version: t.version,
      displayName: t.displayName,
      description: t.description,
      category: t.category,
      sensitivity: t.sensitivity,
      sideEffect: t.sideEffect,
      status: t.status,
      requiresAuthentication: t.requiresAuthentication,
      userScoped: t.userScoped,
      requiredCapabilities: t.requiredCapabilities,
      schemaHash: t.schemaHash,
    }));
  }
}
