import { Injectable, Logger } from '@nestjs/common';
import type { AgentDefinition } from '../../domain/models/agent-definition.model';
import { ContextBuilderService } from '../../../ai/infrastructure/context/context-builder.service';
import { AgentContextSnapshotRepository } from '../../infrastructure/persistence/agent-context-snapshot.repository';
import { TokenCounterService } from '../../../ai/infrastructure/token/token-counter.service';
import { createHash } from 'node:crypto';

@Injectable()
export class AgentContextBuilderService {
  private readonly logger = new Logger(AgentContextBuilderService.name);

  constructor(
    private readonly contextBuilderService: ContextBuilderService,
    private readonly snapshotRepository: AgentContextSnapshotRepository,
    private readonly tokenCounterService: TokenCounterService,
  ) {}

  public async buildAndPersistSnapshot(params: {
    agentDefinition: AgentDefinition;
    userId?: string;
    symbol?: string;
    timeframe?: string;
    provider?: string;
    overrideContextSources?: Record<string, unknown>;
  }): Promise<{ snapshotId: string; contextString: string; tokenEstimate: number }> {
    const { contextString } = this.contextBuilderService.buildContext({});

    const contextHash = createHash('sha256').update(contextString).digest('hex');

    let existing = await this.snapshotRepository.findByHash(contextHash);

    if (!existing) {
      existing = await this.snapshotRepository.create({
        userId: params.userId,
        symbol: params.symbol,
        provider: params.provider,
        timeframe: params.timeframe,
        sourceDataCutoff: new Date(),
        contextHash,
        tokenEstimate: this.tokenCounterService.countTokens(contextString),
        serializedContext: { contextString },
      });
    }

    return {
      snapshotId: existing.id,
      contextString,
      tokenEstimate: existing.tokenEstimate,
    };
  }
}
