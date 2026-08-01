import { Injectable, Logger } from "@nestjs/common";
import { AIProviderType, AIResponseDto } from "@platform/shared";
import { LLMProvider, LLMRequestOptions, LLMResponse, LLMStreamChunk } from "../domain/interfaces/llm-provider.interface";
import { AIConfigService } from "../infrastructure/config/ai-config.service";
import { ContextBuilderService, ContextSourceData } from "../infrastructure/context/context-builder.service";
import { AIHistoryService } from "../infrastructure/history/ai-history.service";
import { PromptEngineService } from "../infrastructure/prompt/prompt-engine.service";
import { LLMProviderFactory } from "../infrastructure/provider/llm-provider.factory";
import { BudgetManagerService } from "../infrastructure/budget/budget-manager.service";
import { CostEstimatorService } from "../infrastructure/budget/cost-estimator.service";

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

  constructor(
    private readonly configService: AIConfigService,
    private readonly budgetManager: BudgetManagerService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly promptEngine: PromptEngineService,
    private readonly providerFactory: LLMProviderFactory,
    private readonly aiHistory: AIHistoryService,
    private readonly costEstimator: CostEstimatorService
  ) {}

  public async execute(options: AIExecuteOptions): Promise<AIResponseDto> {
    const userConfig = await this.configService.getOrCreateConfig(options.userId);

    // 1. Budget check
    const budgetCheck = await this.budgetManager.checkBudget(options.userId);
    if (!budgetCheck.allowed) {
      throw new Error(`AI Request blocked by budget policy: ${budgetCheck.reason}`);
    }

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

    const providerTypesToTry = [primaryProviderType, ...fallbackTypes.filter((p) => p !== primaryProviderType)];

    let lastError: Error | null = null;
    let response: LLMResponse | null = null;

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

  private async executeWithRetry(
    provider: LLMProvider,
    options: LLMRequestOptions,
    maxRetries = 2
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
