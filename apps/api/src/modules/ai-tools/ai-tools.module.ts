import { Module, OnModuleInit } from "@nestjs/common";
import { OpenAIToolSchemaMapper } from "./infrastructure/mappers/openai-tool-schema.mapper";
import { AnthropicToolSchemaMapper } from "./infrastructure/mappers/anthropic-tool-schema.mapper";
import { GeminiToolSchemaMapper } from "./infrastructure/mappers/gemini-tool-schema.mapper";
import { OllamaToolSchemaMapper } from "./infrastructure/mappers/ollama-tool-schema.mapper";
import { ToolArgumentValidator } from "./infrastructure/sanitization/argument-validator";
import { ToolResultSanitizer } from "./infrastructure/sanitization/result-sanitizer";
import { ToolPolicyEngine } from "./infrastructure/policies/tool-policy.engine";
import { ToolLoopGuard } from "./infrastructure/policies/tool-loop.guard";
import { ToolRegistryService } from "./infrastructure/registry/tool-registry.service";
import { ToolExecutorService } from "./infrastructure/executors/tool-executor.service";
import { ParallelToolExecutorService } from "./infrastructure/executors/parallel-tool-executor.service";
import { ToolInvocationRepository } from "./infrastructure/persistence/tool-invocation.repository";
import { ToolRateLimiterService } from "./infrastructure/redis/tool-rate-limiter.service";
import { ToolIdempotencyService } from "./infrastructure/redis/tool-idempotency.service";
import { ToolInvocationService } from "./application/tool-invocation.service";
import { ToolLoopRunnerService } from "./application/tool-loop-runner.service";
import { ToolHealthService } from "./application/tool-health.service";
import { AIToolsController } from "./presentation/controllers/ai-tools.controller";

import {
  MarketTickerGetTool,
  MarketCandlesListTool,
  MarketIndicatorsGetTool,
  MarketFundingGetTool,
  MarketOpenInterestGetTool,
  MarketOrderBookGetTool,
} from "./infrastructure/tools/market-tools";
import { MarketToolDataService } from "./infrastructure/tools/market-tool-data.service";

import {
  NewsArticlesListTool,
  NewsArticleGetTool,
  NewsHighImportanceListTool,
  SentimentMarketGetTool,
  MacroEventsListTool,
  SocialPostsListTool,
} from "./infrastructure/tools/news-tools";

import {
  UserSettingsGetTool,
  UserAiConfigGetTool,
  ExchangeAccountSummaryTool,
  ExchangeAccountBalancesTool,
  ExchangeAccountPositionsTool,
  ExchangeAccountOpenOrdersTool,
} from "./infrastructure/tools/user-and-exchange-tools";

import { DatabaseModule } from "../../database/database.module";
import { RedisModule } from "../../redis/redis.module";
import { SessionModule } from "../../session/session.module";
import { ExchangeModule } from "../../exchange/exchange.module";
import { AIModule } from "../ai/ai.module";
import { MarketDataModule } from "../../market-data/market-data.module";

@Module({
  imports: [DatabaseModule, RedisModule, SessionModule, ExchangeModule, MarketDataModule, AIModule],
  controllers: [AIToolsController],
  providers: [
    OpenAIToolSchemaMapper,
    AnthropicToolSchemaMapper,
    GeminiToolSchemaMapper,
    OllamaToolSchemaMapper,
    ToolArgumentValidator,
    ToolResultSanitizer,
    ToolPolicyEngine,
    ToolLoopGuard,
    ToolRegistryService,
    ToolExecutorService,
    ParallelToolExecutorService,
    ToolInvocationRepository,
    ToolRateLimiterService,
    ToolIdempotencyService,
    ToolInvocationService,
    ToolLoopRunnerService,
    ToolHealthService,
    MarketToolDataService,

    // 18 Safe Tools
    MarketTickerGetTool,
    MarketCandlesListTool,
    MarketIndicatorsGetTool,
    MarketFundingGetTool,
    MarketOpenInterestGetTool,
    MarketOrderBookGetTool,
    NewsArticlesListTool,
    NewsArticleGetTool,
    NewsHighImportanceListTool,
    SentimentMarketGetTool,
    MacroEventsListTool,
    SocialPostsListTool,
    UserSettingsGetTool,
    UserAiConfigGetTool,
    ExchangeAccountSummaryTool,
    ExchangeAccountBalancesTool,
    ExchangeAccountPositionsTool,
    ExchangeAccountOpenOrdersTool,
  ],
  exports: [
    ToolRegistryService,
    ToolExecutorService,
    ParallelToolExecutorService,
    ToolInvocationService,
    ToolLoopRunnerService,
    ToolHealthService,
    OpenAIToolSchemaMapper,
    AnthropicToolSchemaMapper,
    GeminiToolSchemaMapper,
    OllamaToolSchemaMapper,
  ],
})
export class AIToolsModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistryService,

    // Inject all 18 safe tool instances
    private readonly tickerTool: MarketTickerGetTool,
    private readonly candlesTool: MarketCandlesListTool,
    private readonly indicatorsTool: MarketIndicatorsGetTool,
    private readonly fundingTool: MarketFundingGetTool,
    private readonly openInterestTool: MarketOpenInterestGetTool,
    private readonly orderBookTool: MarketOrderBookGetTool,
    private readonly newsArticlesTool: NewsArticlesListTool,
    private readonly newsArticleGetTool: NewsArticleGetTool,
    private readonly newsHighImportanceTool: NewsHighImportanceListTool,
    private readonly sentimentTool: SentimentMarketGetTool,
    private readonly macroTool: MacroEventsListTool,
    private readonly socialTool: SocialPostsListTool,
    private readonly userSettingsTool: UserSettingsGetTool,
    private readonly userAiConfigTool: UserAiConfigGetTool,
    private readonly exchangeSummaryTool: ExchangeAccountSummaryTool,
    private readonly exchangeBalancesTool: ExchangeAccountBalancesTool,
    private readonly exchangePositionsTool: ExchangeAccountPositionsTool,
    private readonly exchangeOrdersTool: ExchangeAccountOpenOrdersTool
  ) {}

  public onModuleInit(): void {
    // Register all 18 safe read-only tools predictably during startup
    this.registry.register(this.tickerTool);
    this.registry.register(this.candlesTool);
    this.registry.register(this.indicatorsTool);
    this.registry.register(this.fundingTool);
    this.registry.register(this.openInterestTool);
    this.registry.register(this.orderBookTool);
    this.registry.register(this.newsArticlesTool);
    this.registry.register(this.newsArticleGetTool);
    this.registry.register(this.newsHighImportanceTool);
    this.registry.register(this.sentimentTool);
    this.registry.register(this.macroTool);
    this.registry.register(this.socialTool);
    this.registry.register(this.userSettingsTool);
    this.registry.register(this.userAiConfigTool);
    this.registry.register(this.exchangeSummaryTool);
    this.registry.register(this.exchangeBalancesTool);
    this.registry.register(this.exchangePositionsTool);
    this.registry.register(this.exchangeOrdersTool);
  }
}
