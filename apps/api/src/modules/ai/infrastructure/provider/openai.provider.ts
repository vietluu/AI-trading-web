import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AIProviderType } from "@platform/shared";
import {
  LLMModelInfo,
  LLMProvider,
  LLMProviderHealth,
  LLMRequestOptions,
  LLMResponse,
  LLMStreamChunk,
} from "../../domain/interfaces/llm-provider.interface";
import { ModelRegistryService } from "../registry/model-registry.service";

@Injectable()
export class OpenAIProvider implements LLMProvider {
  readonly providerType: AIProviderType = "OPENAI";
  private readonly logger = new Logger(OpenAIProvider.name);
  private lastSuccessAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly modelRegistry: ModelRegistryService
  ) {}

  private getApiKey(): string | undefined {
    return this.configService.get<string>("OPENAI_API_KEY");
  }

  private getBaseUrl(): string {
    return (
      this.configService.get<string>("OPENAI_BASE_URL") ||
      "https://api.openai.com/v1"
    );
  }

  public async chat(options: LLMRequestOptions): Promise<LLMResponse> {
    const apiKey = this.getApiKey();
    const startTime = Date.now();
    const model = options.model || "gpt-5-mini";

    if (!apiKey) {
      if (process.env.NODE_ENV === "test" || process.env.MOCK_AI_RESPONSES === "true") {
        return this.generateMockResponse(options, startTime);
      }
      throw new Error("OpenAI API key is not configured (OPENAI_API_KEY)");
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    if (options.messages && options.messages.length > 0) {
      messages.push(...options.messages);
    } else {
      messages.push({ role: "user", content: options.userPrompt });
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    };

    if (options.responseFormat === "json" || options.jsonSchema) {
      body.response_format = { type: "json_object" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 30000
    );

    try {
      const response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.abortSignal || controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        const status = response.status;
        this.lastError = `HTTP ${status}: ${errorText}`;
        const err = new Error(`OpenAI API error (${status}): ${errorText}`);
        Object.assign(err, { status });
        throw err;
      }

      const data = (await response.json()) as {
        choices: Array<{
          message: { content: string };
          finish_reason: string;
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      };

      const latencyMs = Date.now() - startTime;
      const text = data.choices[0]?.message?.content || "";
      const finishReason = data.choices[0]?.finish_reason || "stop";
      const promptTokens = data.usage?.prompt_tokens || Math.ceil((options.userPrompt.length + (options.systemPrompt?.length || 0)) / 4);
      const completionTokens = data.usage?.completion_tokens || Math.ceil(text.length / 4);
      const totalTokens = promptTokens + completionTokens;

      const modelInfo = this.modelRegistry.getModel(model);
      const estimatedCost = modelInfo
        ? (promptTokens / 1000) * modelInfo.inputCostPer1k +
          (completionTokens / 1000) * modelInfo.outputCostPer1k
        : 0;

      let json: Record<string, unknown> | null = null;
      if (options.responseFormat === "json" || options.jsonSchema) {
        try {
          json = JSON.parse(text) as Record<string, unknown>;
        } catch {
          this.logger.warn(`Failed to parse JSON response from OpenAI: ${text}`);
        }
      }

      this.lastSuccessAt = new Date();
      this.lastError = null;

      return {
        text,
        json,
        finishReason,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCost,
        },
        latencyMs,
        provider: this.providerType,
        model,
      };
    } catch (err: unknown) {
      clearTimeout(timeout);
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.lastError = errorMsg;
      if (process.env.NODE_ENV === "test" || process.env.MOCK_AI_RESPONSES === "true") {
        return this.generateMockResponse(options, startTime);
      }
      throw err;
    }
  }

  public async *stream(
    options: LLMRequestOptions
  ): AsyncIterable<LLMStreamChunk> {
    const apiKey = this.getApiKey();
    const model = options.model || "gpt-5-mini";

    if (!apiKey || process.env.MOCK_AI_RESPONSES === "true") {
      const mockText = `[OpenAI Stream Mock Response for: ${options.userPrompt.slice(0, 30)}]`;
      const tokens = mockText.split(" ");
      for (const token of tokens) {
        yield { deltaToken: token + " ", isComplete: false };
        await new Promise((res) => setTimeout(res, 20));
      }
      yield {
        deltaToken: "",
        isComplete: true,
        finishReason: "stop",
        usage: {
          promptTokens: 10,
          completionTokens: tokens.length,
          totalTokens: 10 + tokens.length,
          estimatedCost: 0.0001,
        },
      };
      return;
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: options.userPrompt });

    const response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
        stream: true,
      }),
      signal: options.abortSignal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`OpenAI Stream Error (${response.status}): ${await response.text()}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6);
            if (dataStr === "[DONE]") {
              yield { deltaToken: "", isComplete: true, finishReason: "stop" };
              return;
            }
            try {
              const parsed = JSON.parse(dataStr) as {
                choices: Array<{
                  delta: { content?: string };
                  finish_reason?: string;
                }>;
              };
              const content = parsed.choices[0]?.delta?.content || "";
              const finishReason = parsed.choices[0]?.finish_reason || undefined;
              if (content || finishReason) {
                yield {
                  deltaToken: content,
                  isComplete: Boolean(finishReason),
                  finishReason,
                };
              }
            } catch {
              // ignore parse errors on stream chunk
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  public async embedding(text: string): Promise<number[]> {
    const apiKey = this.getApiKey();
    if (!apiKey || process.env.MOCK_AI_RESPONSES === "true") {
      return new Array(1536).fill(0).map((_, i) => Math.sin(i + text.length));
    }
    const response = await fetch(`${this.getBaseUrl()}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI Embedding error: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    return data.data?.[0]?.embedding || [];
  }

  public countTokens(text: string): Promise<number> {
    return Promise.resolve(Math.ceil(text.length / 4));
  }

  public async health(): Promise<LLMProviderHealth> {
    const apiKey = this.getApiKey();
    const startTime = Date.now();
    const models = this.modelRegistry
      .getModelsByProvider(this.providerType)
      .map((m) => m.name);

    if (!apiKey) {
      return {
        provider: this.providerType,
        status: "NOT_CONFIGURED",
        latencyMs: 0,
        lastSuccessAt: this.lastSuccessAt,
        lastError: "OPENAI_API_KEY is not set",
        models,
      };
    }

    try {
      const res = await fetch(`${this.getBaseUrl()}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const latencyMs = Date.now() - startTime;
      if (res.ok) {
        this.lastSuccessAt = new Date();
        this.lastError = null;
        return {
          provider: this.providerType,
          status: "HEALTHY",
          latencyMs,
          lastSuccessAt: this.lastSuccessAt,
          lastError: null,
          models,
        };
      } else {
        return {
          provider: this.providerType,
          status: "DEGRADED",
          latencyMs,
          lastSuccessAt: this.lastSuccessAt,
          lastError: `HTTP ${res.status}`,
          models,
        };
      }
    } catch (err: unknown) {
      return {
        provider: this.providerType,
        status: "FAILED",
        latencyMs: Date.now() - startTime,
        lastSuccessAt: this.lastSuccessAt,
        lastError: err instanceof Error ? err.message : String(err),
        models,
      };
    }
  }

  public listModels(): Promise<LLMModelInfo[]> {
    return Promise.resolve(this.modelRegistry.getModelsByProvider(this.providerType));
  }

  private generateMockResponse(
    options: LLMRequestOptions,
    startTime: number
  ): LLMResponse {
    const model = options.model || "gpt-5-mini";
    const text = options.responseFormat === "json" || options.jsonSchema
      ? JSON.stringify({ status: "success", mockResult: `OpenAI response for: ${options.userPrompt}` })
      : `[OpenAI ${model} Mock Response]: Processed prompt: "${options.userPrompt.slice(0, 100)}"`;
    
    let json: Record<string, unknown> | null = null;
    if (options.responseFormat === "json" || options.jsonSchema) {
      json = { status: "success", mockResult: `OpenAI response for: ${options.userPrompt}` };
    }

    const promptTokens = Math.ceil(options.userPrompt.length / 4) + 10;
    const completionTokens = Math.ceil(text.length / 4);

    return {
      text,
      json,
      finishReason: "stop",
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCost: 0.0001,
      },
      latencyMs: Date.now() - startTime,
      provider: this.providerType,
      model,
    };
  }
}
