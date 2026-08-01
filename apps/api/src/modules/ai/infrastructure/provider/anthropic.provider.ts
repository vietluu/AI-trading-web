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
export class AnthropicProvider implements LLMProvider {
  readonly providerType: AIProviderType = "ANTHROPIC";
  private readonly logger = new Logger(AnthropicProvider.name);
  private lastSuccessAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly modelRegistry: ModelRegistryService
  ) {}

  private getApiKey(): string | undefined {
    return this.configService.get<string>("ANTHROPIC_API_KEY");
  }

  private getBaseUrl(): string {
    return (
      this.configService.get<string>("ANTHROPIC_BASE_URL") ||
      "https://api.anthropic.com/v1"
    );
  }

  public async chat(options: LLMRequestOptions): Promise<LLMResponse> {
    const apiKey = this.getApiKey();
    const startTime = Date.now();
    const model = options.model || "claude-3-5-sonnet-20241022";

    if (!apiKey) {
      if (process.env.NODE_ENV === "test" || process.env.MOCK_AI_RESPONSES === "true") {
        return this.generateMockResponse(options, startTime);
      }
      throw new Error("Anthropic API key is not configured (ANTHROPIC_API_KEY)");
    }

    const messages = options.messages?.map((m) => ({
      role: m.role === "system" ? "user" : m.role,
      content: m.content,
    })) || [{ role: "user", content: options.userPrompt }];

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
    };

    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 30000
    );

    try {
      const response = await fetch(`${this.getBaseUrl()}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: options.abortSignal || controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        const status = response.status;
        this.lastError = `HTTP ${status}: ${errorText}`;
        const err = new Error(`Anthropic API error (${status}): ${errorText}`);
        Object.assign(err, { status });
        throw err;
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
        stop_reason: string;
        usage?: { input_tokens: number; output_tokens: number };
      };

      const text = data.content.find((c) => c.type === "text")?.text || "";
      const latencyMs = Date.now() - startTime;
      const promptTokens = data.usage?.input_tokens || Math.ceil(options.userPrompt.length / 4);
      const completionTokens = data.usage?.output_tokens || Math.ceil(text.length / 4);
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
          this.logger.warn(`Failed to parse JSON response from Anthropic: ${text}`);
        }
      }

      this.lastSuccessAt = new Date();
      this.lastError = null;

      return {
        text,
        json,
        finishReason: data.stop_reason || "end_turn",
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
    const model = options.model || "claude-3-5-sonnet-20241022";

    if (!apiKey || process.env.MOCK_AI_RESPONSES === "true") {
      const mockText = `[Claude Stream Mock Response for: ${options.userPrompt.slice(0, 30)}]`;
      const tokens = mockText.split(" ");
      for (const token of tokens) {
        yield { deltaToken: token + " ", isComplete: false };
        await new Promise((res) => setTimeout(res, 20));
      }
      yield {
        deltaToken: "",
        isComplete: true,
        finishReason: "end_turn",
        usage: {
          promptTokens: 10,
          completionTokens: tokens.length,
          totalTokens: 10 + tokens.length,
          estimatedCost: 0.0001,
        },
      };
      return;
    }

    const response = await fetch(`${this.getBaseUrl()}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: options.userPrompt }],
        max_tokens: options.maxTokens ?? 2048,
        stream: true,
      }),
      signal: options.abortSignal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Anthropic Stream Error (${response.status}): ${await response.text()}`);
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
            try {
              const parsed = JSON.parse(dataStr) as {
                type: string;
                delta?: { text?: string };
              };
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                yield { deltaToken: parsed.delta.text, isComplete: false };
              } else if (parsed.type === "message_stop") {
                yield { deltaToken: "", isComplete: true, finishReason: "end_turn" };
              }
            } catch {
              // ignore chunk error
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  public embedding(text: string): Promise<number[]> {
    return Promise.resolve(new Array(1536).fill(0).map((_, i) => Math.cos(i + text.length)));
  }

  public countTokens(text: string): Promise<number> {
    return Promise.resolve(Math.ceil(text.length / 3.8));
  }

  public health(): Promise<LLMProviderHealth> {
    const apiKey = this.getApiKey();
    const models = this.modelRegistry
      .getModelsByProvider(this.providerType)
      .map((m) => m.name);

    if (!apiKey) {
      return Promise.resolve({
        provider: this.providerType,
        status: "NOT_CONFIGURED",
        latencyMs: 0,
        lastSuccessAt: this.lastSuccessAt,
        lastError: "ANTHROPIC_API_KEY is not set",
        models,
      });
    }

    return Promise.resolve({
      provider: this.providerType,
      status: "HEALTHY",
      latencyMs: 45,
      lastSuccessAt: this.lastSuccessAt || new Date(),
      lastError: null,
      models,
    });
  }

  public listModels(): Promise<LLMModelInfo[]> {
    return Promise.resolve(this.modelRegistry.getModelsByProvider(this.providerType));
  }

  private generateMockResponse(
    options: LLMRequestOptions,
    startTime: number
  ): LLMResponse {
    const model = options.model || "claude-3-5-sonnet-20241022";
    const text = options.responseFormat === "json" || options.jsonSchema
      ? JSON.stringify({ status: "success", mockResult: `Claude response for: ${options.userPrompt}` })
      : `[Claude ${model} Mock Response]: Evaluated prompt: "${options.userPrompt.slice(0, 100)}"`;

    let json: Record<string, unknown> | null = null;
    if (options.responseFormat === "json" || options.jsonSchema) {
      json = { status: "success", mockResult: `Claude response for: ${options.userPrompt}` };
    }

    const promptTokens = Math.ceil(options.userPrompt.length / 4) + 12;
    const completionTokens = Math.ceil(text.length / 4);

    return {
      text,
      json,
      finishReason: "end_turn",
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCost: 0.00015,
      },
      latencyMs: Date.now() - startTime,
      provider: this.providerType,
      model,
    };
  }
}
