import { Injectable, Logger } from '@nestjs/common';
import { MemoryManagerService } from '../../../ai/infrastructure/memory/memory-manager.service';
import { AgentType, AgentMemoryMode } from '../../domain/enums';
import type { AgentMemoryPolicy } from '../../domain/models/agent-definition.model';
import { AIMemoryType } from '@prisma/client';

@Injectable()
export class AgentMemoryResolverService {
  private readonly logger = new Logger(AgentMemoryResolverService.name);

  constructor(private readonly memoryManagerService: MemoryManagerService) {}

  public async loadMemory(params: {
    userId?: string;
    memoryPolicy: AgentMemoryPolicy;
    agentType: AgentType;
  }): Promise<Record<string, unknown>[]> {
    if (params.memoryPolicy.mode === AgentMemoryMode.NONE || !params.userId) {
      return [];
    }

    try {
      const memories = await this.memoryManagerService.search({
        userId: params.userId,
        types: params.memoryPolicy.readTypes as AIMemoryType[],
        tags: [params.agentType],
        limit: params.memoryPolicy.maxItems,
      });

      return memories.map((m) => ({
        id: m.id,
        type: m.type,
        key: m.key,
        content: m.content as Record<string, unknown>,
        importance: m.importance,
        tags: m.tags,
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to load memory for agent ${params.agentType}: ${msg}`);
      return [];
    }
  }

  public async persistOutput(params: {
    userId?: string;
    memoryPolicy: AgentMemoryPolicy;
    agentType: AgentType;
    output: Record<string, unknown>;
    runId: string;
  }): Promise<void> {
    if (!params.memoryPolicy.persistFinalOutput || !params.userId) {
      return;
    }

    try {
      await this.memoryManagerService.save({
        userId: params.userId,
        type: (params.memoryPolicy.writeTypes[0] as AIMemoryType | undefined) ?? AIMemoryType.OBSERVATION,
        key: `agent_run:${params.agentType}:${params.runId}`,
        content: params.output,
        importance: 60,
        tags: [params.agentType, 'AGENT_OUTPUT'],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to persist memory for agent run ${params.runId}: ${msg}`);
    }
  }
}
