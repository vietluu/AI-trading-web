import { Injectable, Logger } from '@nestjs/common';
import { ToolRegistryService } from '../../../ai-tools/infrastructure/registry/tool-registry.service';
import { AgentError, AgentErrorCode } from '../../domain/errors/agent-errors';
import { AIProviderType } from '@prisma/client';
import type { ToolCapability } from '@platform/shared';

@Injectable()
export class AgentToolResolverService {
  private readonly logger = new Logger(AgentToolResolverService.name);

  constructor(private readonly toolRegistryService: ToolRegistryService) {}

  public resolveTools(params: {
    allowedToolNames: string[];
    requiredCapabilities: string[];
    provider: string;
  }): {
    toolCount: number;
    providerSchemas: unknown[];
    resolvedToolNames: string[];
  } {
    const resolvedToolNames: string[] = [];

    for (const toolName of params.allowedToolNames) {
      const toolDef = this.toolRegistryService.resolveByName(toolName);
      if (!toolDef || toolDef.status !== 'ACTIVE') {
        throw new AgentError(
          AgentErrorCode.AGENT_TOOL_UNAVAILABLE,
          `Tool ${toolName} is unavailable or not active`,
          false,
        );
      }
      resolvedToolNames.push(toolDef.name);
    }

    const providerType = (params.provider.toUpperCase() as AIProviderType) || AIProviderType.OPENAI;
    const providerSchemas = this.toolRegistryService.getProviderSchemas(
      providerType,
      params.requiredCapabilities as ToolCapability[],
      resolvedToolNames,
    );

    return {
      toolCount: resolvedToolNames.length,
      providerSchemas,
      resolvedToolNames,
    };
  }
}
