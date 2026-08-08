import { Injectable, Logger, Optional } from "@nestjs/common";
import { AIProviderType, AIResponseDto } from "@platform/shared";
import { LLMProvider, LLMRequestOptions, LLMResponse, LLMStreamChunk } from "../domain/interfaces/llm-provider.interface";
import { AIConfigService } from "../infrastructure/config/ai-config.service";
import { ContextBuilderService, ContextSourceData } from "../infrastructure/context/context-builder.service";
import { AIHistoryService } from "../infrastructure/history/ai-history.service";
import { PromptEngineService } from "../infrastructure/prompt/prompt-engine.service";
import { LLMProviderFactory } from "../infrastructure/provider/llm-provider.factory";
import { BudgetManagerService } from "../infrastructure/budget/budget-manager.service";
import { CostEstimatorService } from "../infrastructure/budget/cost-estimator.service";
import { RedisService } from "../../../redis/redis.service";
import { createHash } from "node:crypto";

export interface AIExecuteOptions {
  userId: string;
  sessionId?: string;
  provider?: AIProviderType;
  model?: string;
  templateId?: string;
  templateVersion?: number;
  userPrompt?: string;
  systemPrompt?: string;
  variables?: Record<string, unknown>;
  contextSources?: ContextSourceData;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  jsonSchema?: Record<string, unknown>;
  tools?: string[];
}

@Injectable()
export class AIOrchestratorService {
  private readonly logger = new Logger(AIOrchestratorService.name);
  private readonly promptCacheTtlSeconds = 30;
  private readonly maxInMemoryPromptCacheEntries = 500;
  private readonly inMemoryPromptCache = new Map<string, { response: AIResponseDto; expiresAt: number }>();
  private readonly inFlightPromptCache = new Map<string, Promise<AIResponseDto>>();

  constructor(
    private readonly configService: AIConfigService,
    private readonly budgetManager: BudgetManagerService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly promptEngine: PromptEngineService,
    private readonly providerFactory: LLMProviderFactory,
    private readonly aiHistory: AIHistoryService,
    private readonly costEstimator: CostEstimatorService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  public async execute(options: AIExecuteOptions): Promise<AIResponseDto> {
    const userConfig = await this.configService.getOrCreateConfig(options.userId);

    // 2. Build context
    const { contextString } = options.contextSources
      ? this.contextBuilder.buildContext(options.contextSources)
      : { contextString: "" };

    // 3. Render prompt
    const userText =
      options.userPrompt ||
      (typeof options.variables?.user === "string"
        ? options.variables.user
        : JSON.stringify(options.variables?.user || "Hello"));
    const rendered = options.templateId
      ? this.promptEngine.render(
          options.templateId,
          {
            user: { input: userText, ...options.variables },
            system: options.variables?.system as Record<string, unknown>,
            context: { marketContext: contextString },
          },
          options.templateVersion
        )
      : this.promptEngine.renderDirect({
          userPrompt: userText,
          systemPrompt: options.systemPrompt,
          contextPrompt: contextString,
        });

    // 4. Provider resolution & fallback chain
    const primaryProviderType = options.provider || userConfig.preferredProvider;
    const modelName = options.model || userConfig.preferredModel;
    const fallbackTypes = userConfig.fallbackEnabled
      ? (userConfig.fallbackProviders as AIProviderType[])
      : [];

    const promptCacheKey = this.buildPromptCacheKey({
      userId: options.userId,
      provider: primaryProviderType,
      model: modelName,
      systemPrompt: rendered.systemPrompt,
      userPrompt: rendered.userPrompt,
      fullPrompt: rendered.fullPrompt,
      responseFormat: options.responseFormat,
      temperature: options.temperature ?? userConfig.temperature,
      maxTokens: options.maxTokens ?? userConfig.maxTokens,
      jsonSchema: options.jsonSchema,
    });

    const cachedResponse = await this.getCachedResponse(promptCacheKey);
    if (cachedResponse) {
      this.logger.log(`Reusing cached AI response for prompt fingerprint ${promptCacheKey.slice(0, 12)}`);
      return cachedResponse;
    }

    const inFlight = this.inFlightPromptCache.get(promptCacheKey);
    if (inFlight) {
      this.logger.log(`Reusing in-flight AI response for prompt fingerprint ${promptCacheKey.slice(0, 12)}`);
      return inFlight;
    }

    // 1. Budget check
    const budgetCheck = await this.budgetManager.checkBudget(options.userId);
    if (!budgetCheck.allowed) {
      throw new Error(`AI Request blocked by budget policy: ${budgetCheck.reason}`);
    }

    const providerTypesToTry = [primaryProviderType, ...fallbackTypes.filter((p) => p !== primaryProviderType)];

    let lastError: Error | null = null;
    let response: LLMResponse | null = null;
    const executionPromise = (async (): Promise<AIResponseDto> => {
      for (const pType of providerTypesToTry) {
        try {
          const provider = this.providerFactory.getProvider(pType);
          response = await this.executeWithRetry(provider, {
            model: modelName,
            systemPrompt: rendered.systemPrompt,
            userPrompt: rendered.userPrompt,
            temperature: options.temperature ?? userConfig.temperature,
            maxTokens: options.maxTokens ?? userConfig.maxTokens,
            responseFormat: options.responseFormat,
            jsonSchema: options.jsonSchema,
            timeoutMs: userConfig.timeoutMs,
          });
          break; // Success!
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const status = (err as Record<string, unknown>)?.status as number | undefined;

          // Never retry 400, 401, 403 errors
          if (status === 400 || status === 401 || status === 403) {
            this.logger.error(`Non-retryable error (${status}) from provider ${pType}: ${lastError.message}`);
            break;
          }

          this.logger.warn(`Provider ${pType} failed: ${lastError.message}. Attempting fallback...`);
        }
      }

      if (!response) {
        // Log failure in history
        await this.aiHistory.logExecution({
          userId: options.userId,
          sessionId: options.sessionId,
          provider: primaryProviderType,
          model: modelName,
          prompt: rendered.fullPrompt,
          systemPrompt: rendered.systemPrompt,
          response: "",
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
          latencyMs: 0,
          success: false,
          error: lastError?.message || "Execution failed across all providers",
        });

        throw new Error(`AI Request failed: ${lastError?.message || "All providers unavailable"}`);
      }

      await this.setCachedResponse(promptCacheKey, {
        text: response.text,
        json: response.json,
        finishReason: response.finishReason,
        usage: response.usage,
        latencyMs: response.latencyMs,
        provider: response.provider,
        model: response.model,
      });

      // 5. Record usage & history
      await this.budgetManager.recordUsage({
        userId: options.userId,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        cost: response.usage.estimatedCost,
      });

      await this.aiHistory.logExecution({
        userId: options.userId,
        sessionId: options.sessionId,
        provider: response.provider,
        model: response.model,
        prompt: rendered.fullPrompt,
        systemPrompt: rendered.systemPrompt,
        response: response.text,
        responseJson: response.json,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        estimatedCost: response.usage.estimatedCost,
        latencyMs: response.latencyMs,
        success: true,
        finishReason: response.finishReason,
      });

      return {
        text: response.text,
        json: response.json,
        finishReason: response.finishReason,
        usage: response.usage,
        latencyMs: response.latencyMs,
        provider: response.provider,
        model: response.model,
      };
    })();

    this.inFlightPromptCache.set(promptCacheKey, executionPromise);

    try {
      return await executionPromise;
    } finally {
      this.inFlightPromptCache.delete(promptCacheKey);
    }

  }

  public async *stream(options: AIExecuteOptions): AsyncIterable<LLMStreamChunk> {
    const userConfig = await this.configService.getOrCreateConfig(options.userId);
    const primaryProviderType = options.provider || userConfig.preferredProvider;
    const provider = this.providerFactory.getProvider(primaryProviderType);

    const reqOptions: LLMRequestOptions = {
      model: options.model || userConfig.preferredModel,
      systemPrompt: options.systemPrompt,
      userPrompt: options.userPrompt || "",
      temperature: options.temperature ?? userConfig.temperature,
      maxTokens: options.maxTokens ?? userConfig.maxTokens,
    };

    for await (const chunk of provider.stream(reqOptions)) {
      yield chunk;
    }
  }

  private buildPromptCacheKey(params: {
    userId: string;
    provider: AIProviderType;
    model: string;
    systemPrompt?: string;
    userPrompt?: string;
    fullPrompt?: string;
    responseFormat?: "text" | "json";
    temperature?: number;
    maxTokens?: number;
    jsonSchema?: Record<string, unknown>;
  }): string {
    const payload = JSON.stringify({
      userId: params.userId,
      provider: params.provider,
      model: params.model,
      systemPrompt: params.systemPrompt || "",
      userPrompt: params.userPrompt || "",
      fullPrompt: params.fullPrompt || "",
      responseFormat: params.responseFormat,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      jsonSchema: params.jsonSchema ? JSON.stringify(params.jsonSchema) : undefined,
    });

    return createHash("sha256").update(payload).digest("hex");
  }

  private async getCachedResponse(cacheKey: string): Promise<AIResponseDto | null> {
    const now = Date.now();
    const inMemoryEntry = this.inMemoryPromptCache.get(cacheKey);
    if (inMemoryEntry && inMemoryEntry.expiresAt > now) {
      return inMemoryEntry.response;
    }

    if (inMemoryEntry) {
      this.inMemoryPromptCache.delete(cacheKey);
    }

    if (!this.redisService) {
      return null;
    }

    try {
      const cachedPayload = await this.redisService.get(cacheKey);
      if (!cachedPayload) {
        return null;
      }

      const parsed = JSON.parse(cachedPayload) as { response: AIResponseDto; expiresAt: number };
      if (parsed.expiresAt <= now) {
        await this.redisService.delete(cacheKey);
        return null;
      }

      return parsed.response;
    } catch (error) {
      this.logger.warn(`Unable to read cached AI response for ${cacheKey}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async setCachedResponse(cacheKey: string, response: AIResponseDto): Promise<void> {
    const expiresAt = Date.now() + this.promptCacheTtlSeconds * 1000;
    if (this.inMemoryPromptCache.size >= this.maxInMemoryPromptCacheEntries) {
      const now = Date.now();
      for (const [key, entry] of this.inMemoryPromptCache) {
        if (entry.expiresAt <= now) this.inMemoryPromptCache.delete(key);
      }
      while (this.inMemoryPromptCache.size >= this.maxInMemoryPromptCacheEntries) {
        const oldestKey = this.inMemoryPromptCache.keys().next().value;
        if (!oldestKey) break;
        this.inMemoryPromptCache.delete(oldestKey);
      }
    }
    this.inMemoryPromptCache.set(cacheKey, { response, expiresAt });

    if (!this.redisService) {
      return;
    }

    try {
      await this.redisService.setWithTtl(cacheKey, JSON.stringify({ response, expiresAt }), this.promptCacheTtlSeconds);
    } catch (error) {
      this.logger.warn(`Unable to write cached AI response for ${cacheKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async executeWithRetry(
    provider: LLMProvider,
    options: LLMRequestOptions,
    maxRetries = 0
  ): Promise<LLMResponse> {
    let attempt = 0;
    let delay = 500;

    while (attempt <= maxRetries) {
      try {
        return await provider.chat(options);
      } catch (err: unknown) {
        attempt++;
        const status = (err as Record<string, unknown>)?.status as number | undefined;

        // Never retry 400, 401, 403
        if (status === 400 || status === 401 || status === 403 || attempt > maxRetries) {
          throw err;
        }

        this.logger.warn(`Retrying AI call (attempt ${attempt}/${maxRetries}) after ${delay}ms...`);
        await new Promise((res) => setTimeout(res, delay));
        delay *= 2;
      }
    }

    throw new Error("Maximum retries reached");
  }
}
