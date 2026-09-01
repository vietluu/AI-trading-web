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
  symbol?: string;
  timeframe?: string;
  contextHash?: string;
  correlationId?: string;
  cycleKey?: string;
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
  private readonly geminiFallbackModels = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3-flash",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ];
  private readonly defaultModelsByProvider: Record<AIProviderType, string> = {
    OPENAI: "gpt-5-mini",
    ANTHROPIC: "claude-3-5-sonnet-20241022",
    GEMINI: "gemini-3.1-flash-lite",
    OLLAMA: "llama3",
  };
  private readonly inMemoryModelCooldowns = new Map<
    string,
    { until: number; status: number }
  >();

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
      symbol: options.symbol,
      timeframe: options.timeframe,
      contextHash: options.contextHash,
      correlationId: options.correlationId,
      cycleKey: options.cycleKey,
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

    const candidates = this.buildCandidates(
      primaryProviderType,
      modelName,
      fallbackTypes,
    );

    let lastError: Error | null = null;
    let response: LLMResponse | null = null;
    const executionStartedAt = Date.now();
    const attemptedCandidates: Array<{ provider: AIProviderType; model: string; outcome: "tried" | "skipped"; reason?: string; status?: number; code?: string }> = [];
    const authBlockedProviders = new Set<AIProviderType>();
    const executionPromise = (async (): Promise<AIResponseDto> => {
      for (const candidate of candidates) {
        const { provider: pType, model } = candidate;
        if (authBlockedProviders.has(pType)) {
          attemptedCandidates.push({
            provider: pType,
            model,
            outcome: "skipped",
            reason: "provider authentication previously failed",
            status: 401,
            code: "AI_PROVIDER_AUTH_BLOCKED",
          });
          continue;
        }
        const cooldown = await this.getModelCooldown(pType, model);
        if (cooldown.seconds > 0) {
          const isQuotaCooldown = cooldown.status === 429;
          const cooldownCode = isQuotaCooldown
            ? 'AI_PROVIDER_COOLDOWN'
            : 'AI_PROVIDER_UNAVAILABLE_COOLDOWN';
          const cooldownErr = Object.assign(
            new Error(`${pType}/${model} ${isQuotaCooldown ? 'quota' : 'availability'} cooldown is active (${cooldown.seconds}s remaining)`),
            { status: cooldown.status, providerRequestSent: false, code: cooldownCode },
          );
          lastError = cooldownErr;
          attemptedCandidates.push({ provider: pType, model, outcome: "skipped", reason: `${cooldown.seconds}s remaining`, status: cooldown.status, code: cooldownCode });
          this.logger.warn(`AI fallback skipped ${pType}/${model} because its ${isQuotaCooldown ? 'quota' : 'availability'} cooldown is active (${cooldown.seconds}s remaining).`);
          continue;
        }
        try {
          await this.budgetManager.reserveRequest(options.userId);
          const provider = this.providerFactory.getProvider(pType);
          response = await this.executeWithRetry(provider, {
            model,
            systemPrompt: rendered.systemPrompt,
            userPrompt: rendered.userPrompt,
            temperature: options.temperature ?? userConfig.temperature,
            maxTokens: options.maxTokens ?? userConfig.maxTokens,
            responseFormat: options.responseFormat,
            jsonSchema: options.jsonSchema,
            timeoutMs: userConfig.timeoutMs,
          });
          attemptedCandidates.push({ provider: pType, model, outcome: "tried" });
          break; // Success!
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const errorRecord = err as Record<string, unknown>;
          const status = errorRecord?.status as number | undefined;
          const requestWasSent = errorRecord?.providerRequestSent !== false;
          const code = errorRecord?.code as string | undefined;
          attemptedCandidates.push({ provider: pType, model, outcome: "tried", status, code, reason: lastError.message });

          if (status === 429 || (status != null && status >= 500)) {
            const providerRetryAfterMs = errorRecord?.retryAfterMs as number | undefined;
            const retryAfterMs = this.isGeminiDailyQuotaError(
              pType,
              status,
              lastError.message,
            )
              ? Math.max(60_000, this.nextPacificMidnight() - Date.now())
              : providerRetryAfterMs;
            await this.openModelCooldown(
              pType,
              model,
              retryAfterMs,
              status,
            );
          }

          if (requestWasSent) {
            await this.aiHistory.logExecution({
              userId: options.userId,
              sessionId: options.sessionId,
              provider: pType,
              model,
              prompt: rendered.fullPrompt,
              systemPrompt: rendered.systemPrompt,
              response: "",
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              estimatedCost: 0,
              latencyMs: Date.now() - executionStartedAt,
              success: false,
              error: lastError.message,
            });
          }

          // Authentication failures are provider-scoped. Do not retry sibling
          // models on that provider, but continue the independent fallback
          // chain instead of aborting every remaining candidate.
          if (status === 401 || status === 403) {
            this.logger.error(`Non-retryable auth error (${status}) from provider ${pType}: ${lastError.message}`);
            authBlockedProviders.add(pType);
            continue;
          }
          if (code === "AI_REQUEST_BUDGET_EXCEEDED") break;

          this.logger.warn(`${pType}/${model} failed: ${lastError.message}. Attempting fallback...`);
        }
      }

      if (!response) {
        const lastErrRecord = lastError as Record<string, unknown> | null;
        const triedQuotaFailures = attemptedCandidates.filter(
          (candidate) => candidate.outcome === "tried" && (candidate.status === 429 || candidate.code === "AI_PROVIDER_COOLDOWN"),
        );
        const skippedCooldowns = attemptedCandidates.filter(
          (candidate) => candidate.outcome === "skipped" && candidate.status === 429,
        );
        const isQuotaExceeded = lastErrRecord?.status === 429 || lastErrRecord?.code === 'AI_PROVIDER_COOLDOWN' || triedQuotaFailures.length > 0 || skippedCooldowns.length > 0;
        if (isQuotaExceeded) {
          const candidateSummary = attemptedCandidates.length > 0
            ? attemptedCandidates.map((candidate) => `${candidate.provider}/${candidate.model}:${candidate.outcome}${candidate.status ? `:${candidate.status}` : ""}`).join("; ")
            : "none";

          if (lastErrRecord?.code === 'AI_PROVIDER_COOLDOWN' || skippedCooldowns.length > 0 && triedQuotaFailures.length === 0) {
            this.logger.error(`AI quota cooldown prevented the request for all remaining candidates. Tried/fallback chain: ${candidateSummary}`);
            throw lastError ?? new Error(`AI Request failed: quota cooldown is active`);
          }

          this.logger.error(`All candidate AI models hit HTTP 429 quota limits or active cooldowns. Tried/fallback chain: ${candidateSummary}`);
          const quotaErr = new Error(
            `AI Request failed: all candidate models exhausted by quota/cooldown. Tried/fallback chain: ${candidateSummary}`,
          );
          Object.assign(quotaErr, { status: 429, code: 'ALL_MODELS_QUOTA_EXCEEDED', providerRequestSent: false });
          throw quotaErr;
        }
        const unavailableCandidates = attemptedCandidates.filter(
          (candidate) => (candidate.status != null && candidate.status >= 500) || candidate.code === 'AI_PROVIDER_UNAVAILABLE_COOLDOWN',
        );
        if (unavailableCandidates.length > 0) {
          const unavailableErr = new Error(
            `AI Request failed: all candidate models are temporarily unavailable`,
          );
          Object.assign(unavailableErr, {
            status: 503,
            code: 'ALL_MODELS_UNAVAILABLE',
            providerRequestSent: false,
          });
          throw unavailableErr;
        }
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
    symbol?: string;
    timeframe?: string;
    contextHash?: string;
    correlationId?: string;
    cycleKey?: string;
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
      symbol: params.symbol ?? "",
      timeframe: params.timeframe ?? "",
      contextHash: params.contextHash ?? "",
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

  private buildCandidates(
    primaryProvider: AIProviderType,
    primaryModel: string,
    fallbackProviders: AIProviderType[],
  ): Array<{ provider: AIProviderType; model: string }> {
    const seen = new Set<string>();
    const candidates: Array<{ provider: AIProviderType; model: string }> = [];
    const push = (provider: AIProviderType, model: string) => {
      const key = `${provider}:${model}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ provider, model });
    };

    const normalizedPrimaryModel = primaryModel || this.defaultModelsByProvider[primaryProvider];
    push(primaryProvider, normalizedPrimaryModel);

    // Provider quota is commonly shared by sibling models. Prefer an
    // independent provider before spending requests on alternate models.
    for (const provider of fallbackProviders) {
      if (provider === primaryProvider) continue;
      const fallbackModel = this.defaultModelsByProvider[provider] || normalizedPrimaryModel;
      push(provider, fallbackModel);
    }

    if (primaryProvider === "GEMINI") {
      for (const model of this.geminiFallbackModels) {
        if (model !== normalizedPrimaryModel) push(primaryProvider, model);
      }
    }

    return candidates;
  }

  private isGeminiDailyQuotaError(
    provider: AIProviderType,
    status: number | undefined,
    message: string,
  ): boolean {
    if (provider !== "GEMINI" || status !== 429) return false;
    const normalized = message.toLowerCase();
    return (
      normalized.includes("exceeded your current quota") ||
      normalized.includes("requests per day") ||
      normalized.includes("request_per_day") ||
      normalized.includes("perday")
    );
  }

  private modelCooldownKey(provider: AIProviderType, model: string): string {
    return `ai:model:${provider}:${model}:quota-cooldown`;
  }

  private async getModelCooldown(
    provider: AIProviderType,
    model: string,
  ): Promise<{ seconds: number; status: number }> {
    const key = `${provider}:${model}`;
    const memory = this.inMemoryModelCooldowns.get(key);
    if (memory && memory.until > Date.now()) {
      return {
        seconds: Math.max(1, Math.ceil((memory.until - Date.now()) / 1_000)),
        status: memory.status,
      };
    }
    if (memory && memory.until <= Date.now()) {
      this.inMemoryModelCooldowns.delete(key);
    }
    if (!this.redisService) return { seconds: 0, status: 0 };
    try {
      const raw = await this.redisService.get(this.modelCooldownKey(provider, model));
      if (!raw) return { seconds: 0, status: 0 };
      const parsed = raw.startsWith('{')
        ? JSON.parse(raw) as { until?: number; status?: number }
        : { until: Number(raw), status: 429 };
      const until = Number(parsed.until);
      return Number.isFinite(until) && until > Date.now()
        ? {
            seconds: Math.max(1, Math.ceil((until - Date.now()) / 1_000)),
            status: parsed.status === 503 ? 503 : 429,
          }
        : { seconds: 0, status: 0 };
    } catch {
      return { seconds: 0, status: 0 };
    }
  }

  private async openModelCooldown(
    provider: AIProviderType,
    model: string,
    retryAfterMs?: number,
    status = 429,
  ): Promise<void> {
    // Default cooldown is 5 minutes (300s) for rate limit recovery,
    // allowing automatic resumption on subsequent scheduler cycles.
    const cooldownMs = retryAfterMs && retryAfterMs > 0
      ? retryAfterMs
      : status === 429 ? 300_000 : 30_000;
    const resetAt = Date.now() + cooldownMs;
    const key = `${provider}:${model}`;
    this.inMemoryModelCooldowns.set(key, { until: resetAt, status });

    if (!this.redisService) return;
    const ttlSeconds = Math.max(60, Math.ceil(cooldownMs / 1_000));
    try {
      await this.redisService.setWithTtl(
        this.modelCooldownKey(provider, model),
        JSON.stringify({ until: resetAt, status }),
        ttlSeconds,
      );
    } catch (error) {
      this.logger.warn(
        `Unable to open ${provider}/${model} cooldown: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Gemini RPD quotas reset at midnight in America/Los_Angeles. */
  private nextPacificMidnight(now = new Date()): number {
    const timeZone = "America/Los_Angeles";
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const nextDay = new Date(Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day) + 1,
    ));
    const localMidnightAsUtc = Date.UTC(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth(),
      nextDay.getUTCDate(),
    );
    const probeParts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(localMidnightAsUtc));
    const probe = Object.fromEntries(probeParts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(
      Number(probe.year),
      Number(probe.month) - 1,
      Number(probe.day),
      Number(probe.hour),
      Number(probe.minute),
      Number(probe.second),
    );
    return localMidnightAsUtc - (represented - localMidnightAsUtc);
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
