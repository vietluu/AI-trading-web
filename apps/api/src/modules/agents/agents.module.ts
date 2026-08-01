import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

// Domain Definitions
import { SYSTEM_DIAGNOSTIC_DEFINITION } from './domain/definitions/system-diagnostic.definition';
import { MARKET_ANALYST_DEFINITION } from './domain/definitions/market-analyst.definition';
import { TECHNICAL_ANALYST_DEFINITION } from './domain/definitions/technical-analyst.definition';
import { NEWS_ANALYST_DEFINITION } from './domain/definitions/news-analyst.definition';
import { SENTIMENT_ANALYST_DEFINITION } from './domain/definitions/sentiment-analyst.definition';
import { MACRO_ANALYST_DEFINITION } from './domain/definitions/macro-analyst.definition';
import { ON_CHAIN_ANALYST_DEFINITION } from './domain/definitions/on-chain-analyst.definition';
import { DECISION_SYNTHESIZER_DEFINITION } from './domain/definitions/decision-synthesizer.definition';

// Infrastructure
import { AgentRegistryService } from './infrastructure/registry/agent-registry.service';
import { AgentRunRepository } from './infrastructure/persistence/agent-run.repository';
import { AgentContextSnapshotRepository } from './infrastructure/persistence/agent-context-snapshot.repository';
import { AgentRunProducer } from './infrastructure/queues/agent-run.producer';
import { AgentRunProcessor } from './infrastructure/queues/agent-run.processor';
import { AgentConcurrencyService } from './infrastructure/redis/agent-concurrency.service';
import { AgentQuotaService } from './infrastructure/redis/agent-quota.service';
import { AgentCancellationService } from './infrastructure/redis/agent-cancellation.service';
import { AgentIdempotencyService } from './infrastructure/redis/agent-idempotency.service';

// Application
import { AgentCancellationHandlerService } from './application/services/agent-cancellation-handler.service';
import { AgentExecutionService } from './application/services/agent-execution.service';
import { AgentRunnerService } from './application/runners/agent-runner.service';
import { AgentHealthService } from './application/services/agent-health.service';
import { AgentReplayService } from './application/services/agent-replay.service';
import { AgentMemoryResolverService } from './application/services/agent-memory-resolver.service';
import { AgentOutputValidatorService } from './application/services/agent-output-validator.service';
import { AgentPromptResolverService } from './application/services/agent-prompt-resolver.service';
import { AgentToolResolverService } from './application/services/agent-tool-resolver.service';
import { AgentContextBuilderService } from './application/context/agent-context-builder.service';
import { AgentPolicyEngine } from './application/policies/agent-policy.engine';
import { FusionService } from './application/services/fusion.service';
import { DecisionService } from './application/services/decision.service';

// Shared Infra Modules
import { DatabaseModule } from '../../database/database.module';
import { RedisModule } from '../../redis/redis.module';
import { SessionModule } from '../../session/session.module';
import { AIModule } from '../ai/ai.module';
import { AIToolsModule } from '../ai-tools/ai-tools.module';

// Controllers
import { AgentsController, AgentRunsController } from './presentation/controllers/agents.controller';
import { AgentSseController } from './presentation/controllers/agent-sse.controller';
import { DecisionController } from './presentation/controllers/decision.controller';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    SessionModule,
    AIModule,
    AIToolsModule,
    BullModule.registerQueue({
      name: 'agent-runs',
    }),
  ],
  controllers: [AgentsController, AgentRunsController, AgentSseController, DecisionController],
  providers: [
    // Registry
    AgentRegistryService,

    // Repositories
    AgentRunRepository,
    AgentContextSnapshotRepository,

    // Redis Services
    AgentConcurrencyService,
    AgentQuotaService,
    AgentCancellationService,
    AgentIdempotencyService,

    // Queues
    AgentRunProducer,
    AgentRunProcessor,

    // Application Services
    AgentCancellationHandlerService,
    AgentExecutionService,
    AgentRunnerService,
    AgentHealthService,
    AgentReplayService,
    AgentMemoryResolverService,
    AgentOutputValidatorService,
    AgentPromptResolverService,
    AgentToolResolverService,
    AgentContextBuilderService,
    AgentPolicyEngine,
    FusionService,
    DecisionService,
  ],
  exports: [
    AgentRegistryService,
    AgentExecutionService,
    AgentRunnerService,
    AgentHealthService,
    FusionService,
    DecisionService,
  ],
})
export class AgentsModule implements OnModuleInit {
  constructor(private readonly agentRegistryService: AgentRegistryService) {}

  public onModuleInit() {
    this.agentRegistryService.register(SYSTEM_DIAGNOSTIC_DEFINITION);
    this.agentRegistryService.register(MARKET_ANALYST_DEFINITION);
    this.agentRegistryService.register(TECHNICAL_ANALYST_DEFINITION);
    this.agentRegistryService.register(NEWS_ANALYST_DEFINITION);
    this.agentRegistryService.register(SENTIMENT_ANALYST_DEFINITION);
    this.agentRegistryService.register(MACRO_ANALYST_DEFINITION);
    this.agentRegistryService.register(ON_CHAIN_ANALYST_DEFINITION);
    this.agentRegistryService.register(DECISION_SYNTHESIZER_DEFINITION);
  }
}
