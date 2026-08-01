import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { RedisModule } from "../../redis/redis.module";
import { AIOrchestratorService } from "./application/ai-orchestrator.service";

// Infrastructure
import { OpenAIProvider } from "./infrastructure/provider/openai.provider";
import { AnthropicProvider } from "./infrastructure/provider/anthropic.provider";
import { GeminiProvider } from "./infrastructure/provider/gemini.provider";
import { OllamaProvider } from "./infrastructure/provider/ollama.provider";
import { LLMProviderFactory } from "./infrastructure/provider/llm-provider.factory";

import { PromptRenderer } from "./infrastructure/prompt/prompt-renderer";
import { PromptRegistry } from "./infrastructure/prompt/prompt-registry";
import { PromptEngineService } from "./infrastructure/prompt/prompt-engine.service";

import { ContextCompressor } from "./infrastructure/context/context-compressor";
import { ContextBuilderService } from "./infrastructure/context/context-builder.service";

import { ShortMemoryService } from "./infrastructure/memory/short-memory.service";
import { LongMemoryService } from "./infrastructure/memory/long-memory.service";
import { MemoryManagerService } from "./infrastructure/memory/memory-manager.service";

import { TokenCounterService } from "./infrastructure/token/token-counter.service";
import { BudgetManagerService } from "./infrastructure/budget/budget-manager.service";
import { CostEstimatorService } from "./infrastructure/budget/cost-estimator.service";

import { AIHistoryService } from "./infrastructure/history/ai-history.service";
import { ModelRegistryService } from "./infrastructure/registry/model-registry.service";
import { ToolRegistryService } from "./infrastructure/tool/tool-registry.service";
import { ToolExecutorService } from "./infrastructure/tool/tool-executor.service";

import { AIConfigService } from "./infrastructure/config/ai-config.service";
import { AIEvaluationService } from "./infrastructure/evaluation/ai-evaluator.service";

// Presentation
import { AIController } from "./presentation/controllers/ai.controller";

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [AIController],
  providers: [
    OpenAIProvider,
    AnthropicProvider,
    GeminiProvider,
    OllamaProvider,
    LLMProviderFactory,
    PromptRenderer,
    PromptRegistry,
    PromptEngineService,
    ContextCompressor,
    ContextBuilderService,
    ShortMemoryService,
    LongMemoryService,
    MemoryManagerService,
    TokenCounterService,
    BudgetManagerService,
    CostEstimatorService,
    AIHistoryService,
    ModelRegistryService,
    ToolRegistryService,
    ToolExecutorService,
    AIConfigService,
    AIEvaluationService,
    AIOrchestratorService,
  ],
  exports: [
    AIOrchestratorService,
    LLMProviderFactory,
    PromptEngineService,
    ContextBuilderService,
    MemoryManagerService,
    TokenCounterService,
    BudgetManagerService,
    CostEstimatorService,
    AIHistoryService,
    ModelRegistryService,
    ToolRegistryService,
    ToolExecutorService,
    AIConfigService,
    AIEvaluationService,
  ],
})
export class AIModule {}
