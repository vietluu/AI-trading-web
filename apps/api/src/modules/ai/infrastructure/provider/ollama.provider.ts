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
export class OllamaProvider implements LLMProvider {
  readonly providerType: AIProviderType = "OLLAMA";
  private readonly logger = new Logger(OllamaProvider.name);
  private lastSuccessAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly modelRegistry: ModelRegistryService
  ) {}

  private getBaseUrl(): string {
    return (
      this.configService.get<string>("OLLAMA_BASE_URL") ||
      "http://localhost:11434"
    );
  }

  public async chat(options: LLMRequestOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    const model = options.model || "llama3";
    const baseUrl = this.getBaseUrl();

    const messages = [];
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: options.userPrompt });

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 2048,
      },
    };

    if (options.responseFormat === "json" || options.jsonSchema) {
      body.format = "json";
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 60000
    );

    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options.abortSignal || controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        const status = response.status;
        this.lastError = `HTTP ${status}: ${errorText}`;
        const err = new Error(`Ollama API error (${status}): ${errorText}`);
        Object.assign(err, { status });
        throw err;
      }

      const data = (await response.json()) as {
        message: { content: string };
        done_reason?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };

      const text = data.message?.content || "";
      const latencyMs = Date.now() - startTime;
      const promptTokens =
        data.prompt_eval_count || Math.ceil(options.userPrompt.length / 4);
      const completionTokens =
        data.eval_count || Math.ceil(text.length / 4);
      const totalTokens = promptTokens + completionTokens;

      let json: Record<string, unknown> | null = null;
      if (options.responseFormat === "json" || options.jsonSchema) {
        try {
          json = JSON.parse(text) as Record<string, unknown>;
        } catch {
          this.logger.warn(`Failed to parse JSON response from Ollama: ${text}`);
        }
      }

      this.lastSuccessAt = new Date();
      this.lastError = null;

      return {
        text,
        json,
        finishReason: data.done_reason || "stop",
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCost: 0,
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
    const model = options.model || "llama3";
    const baseUrl = this.getBaseUrl();

    if (process.env.MOCK_AI_RESPONSES === "true") {
      const mockText = `[Ollama Local Stream Mock Response for: ${options.userPrompt.slice(0, 30)}]`;
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
          estimatedCost: 0,
        },
      };
      return;
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: options.userPrompt }],
        stream: true,
      }),
      signal: options.abortSignal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Ollama Stream Error (${response.status}): ${await response.text()}`);
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
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as {
              message?: { content?: string };
              done?: boolean;
            };
            const content = parsed.message?.content || "";
            if (content) {
              yield { deltaToken: content, isComplete: Boolean(parsed.done) };
            }
          } catch {
            // ignore chunk parse error
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  public embedding(text: string): Promise<number[]> {
    return Promise.resolve(new Array(4096).fill(0).map((_, i) => Math.sin(i + text.length)));
  }

  public countTokens(text: string): Promise<number> {
    return Promise.resolve(Math.ceil(text.length / 4));
  }

  public async health(): Promise<LLMProviderHealth> {
    const startTime = Date.now();
    const baseUrl = this.getBaseUrl();
    const models = this.modelRegistry
      .getModelsByProvider(this.providerType)
      .map((m) => m.name);

    try {
      const res = await fetch(`${baseUrl}/api/tags`, { method: "GET" });
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
      }
      return {
        provider: this.providerType,
        status: "DEGRADED",
        latencyMs,
        lastSuccessAt: this.lastSuccessAt,
        lastError: `HTTP ${res.status}`,
        models,
      };
    } catch {
      return {
        provider: this.providerType,
        status: "NOT_CONFIGURED",
        latencyMs: Date.now() - startTime,
        lastSuccessAt: this.lastSuccessAt,
        lastError: `Ollama service unreachable at ${baseUrl}`,
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
    const model = options.model || "llama3";
    const text = options.responseFormat === "json" || options.jsonSchema
      ? JSON.stringify({ status: "success", mockResult: `Ollama response for: ${options.userPrompt}` })
      : `[Ollama ${model} Mock Response]: Processed prompt: "${options.userPrompt.slice(0, 100)}"`;

    let json: Record<string, unknown> | null = null;
    if (options.responseFormat === "json" || options.jsonSchema) {
      json = { status: "success", mockResult: `Ollama response for: ${options.userPrompt}` };
    }

    const promptTokens = Math.ceil(options.userPrompt.length / 4) + 5;
    const completionTokens = Math.ceil(text.length / 4);

    return {
      text,
      json,
      finishReason: "stop",
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCost: 0,
      },
      latencyMs: Date.now() - startTime,
      provider: this.providerType,
      model,
    };
  }
}
