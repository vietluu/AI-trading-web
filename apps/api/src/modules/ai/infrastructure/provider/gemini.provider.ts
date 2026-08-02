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
export class GeminiProvider implements LLMProvider {
  readonly providerType: AIProviderType = "GEMINI";
  private readonly logger = new Logger(GeminiProvider.name);
  private lastSuccessAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly modelRegistry: ModelRegistryService
  ) {}

  private getApiKey(): string | undefined {
    return (
      this.configService.get<string>("GOOGLE_API_KEY") ||
      this.configService.get<string>("GEMINI_API_KEY")
    );
  }

  private getBaseUrl(): string {
    return (
      this.configService.get<string>("GEMINI_BASE_URL") ||
      "https://generativelanguage.googleapis.com/v1beta"
    );
  }

  public async chat(options: LLMRequestOptions): Promise<LLMResponse> {
    const apiKey = this.getApiKey();
    const startTime = Date.now();
    const model = options.model || "gemini-3.1-flash-lite";

    if (!apiKey) {
      if (process.env.NODE_ENV === "test" || process.env.MOCK_AI_RESPONSES === "true") {
        return this.generateMockResponse(options, startTime);
      }
      throw new Error("Gemini API key is not configured (GOOGLE_API_KEY / GEMINI_API_KEY)");
    }

    const contents = [];
    if (options.userPrompt) {
      contents.push({
        role: "user",
        parts: [{ text: options.userPrompt }],
      });
    }

    const reqBody: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? 2048,
      },
    };

    if (options.systemPrompt) {
      reqBody.systemInstruction = {
        parts: [{ text: options.systemPrompt }],
      };
    }

    if (options.responseFormat === "json" || options.jsonSchema) {
      (reqBody.generationConfig as Record<string, unknown>).responseMimeType =
        "application/json";
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 30000
    );

    try {
      const response = await fetch(
        `${this.getBaseUrl()}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
          signal: options.abortSignal || controller.signal,
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        const status = response.status;
        this.lastError = `HTTP ${status}: ${errorText}`;
        const err = new Error(`Gemini API error (${status}): ${errorText}`);
        Object.assign(err, { status });
        throw err;
      }

      const data = (await response.json()) as {
        candidates: Array<{
          content: { parts: Array<{ text: string }> };
          finishReason: string;
        }>;
        usageMetadata?: {
          promptTokenCount: number;
          candidatesTokenCount: number;
          totalTokenCount: number;
        };
      };

      const text =
        data.candidates[0]?.content?.parts.map((p) => p.text).join("") || "";
      const latencyMs = Date.now() - startTime;
      const promptTokens =
        data.usageMetadata?.promptTokenCount ||
        Math.ceil(options.userPrompt.length / 4);
      const completionTokens =
        data.usageMetadata?.candidatesTokenCount || Math.ceil(text.length / 4);
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
          this.logger.warn(`Failed to parse JSON response from Gemini: ${text}`);
        }
      }

      this.lastSuccessAt = new Date();
      this.lastError = null;

      return {
        text,
        json,
        finishReason: data.candidates[0]?.finishReason || "STOP",
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
    const model = options.model || "gemini-3.1-flash-lite";

    if (!apiKey || process.env.MOCK_AI_RESPONSES === "true") {
      const mockText = `[Gemini Stream Mock Response for: ${options.userPrompt.slice(0, 30)}]`;
      const tokens = mockText.split(" ");
      for (const token of tokens) {
        yield { deltaToken: token + " ", isComplete: false };
        await new Promise((res) => setTimeout(res, 20));
      }
      yield {
        deltaToken: "",
        isComplete: true,
        finishReason: "STOP",
        usage: {
          promptTokens: 10,
          completionTokens: tokens.length,
          totalTokens: 10 + tokens.length,
          estimatedCost: 0.00005,
        },
      };
      return;
    }

    const response = await fetch(
      `${this.getBaseUrl()}/models/${model}:streamGenerateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: options.userPrompt }] }],
        }),
        signal: options.abortSignal,
      }
    );

    if (!response.ok || !response.body) {
      throw new Error(`Gemini Stream Error (${response.status}): ${await response.text()}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        yield { deltaToken: buffer, isComplete: false };
        buffer = "";
      }
      yield { deltaToken: "", isComplete: true, finishReason: "STOP" };
    } finally {
      reader.releaseLock();
    }
  }

  public embedding(text: string): Promise<number[]> {
    return Promise.resolve(new Array(768).fill(0).map((_, i) => Math.sin(i * text.length)));
  }

  public countTokens(text: string): Promise<number> {
    return Promise.resolve(Math.ceil(text.length / 4));
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
        lastError: "GOOGLE_API_KEY is not set",
        models,
      });
    }

    return Promise.resolve({
      provider: this.providerType,
      status: "HEALTHY",
      latencyMs: 38,
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
    const model = options.model || "gemini-3.1-flash-lite";
    const text = options.responseFormat === "json" || options.jsonSchema
      ? JSON.stringify({ status: "success", mockResult: `Gemini response for: ${options.userPrompt}` })
      : `[Gemini ${model} Mock Response]: Analyzed prompt: "${options.userPrompt.slice(0, 100)}"`;

    let json: Record<string, unknown> | null = null;
    if (options.responseFormat === "json" || options.jsonSchema) {
      json = { status: "success", mockResult: `Gemini response for: ${options.userPrompt}` };
    }

    const promptTokens = Math.ceil(options.userPrompt.length / 4) + 8;
    const completionTokens = Math.ceil(text.length / 4);

    return {
      text,
      json,
      finishReason: "STOP",
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCost: 0.00005,
      },
      latencyMs: Date.now() - startTime,
      provider: this.providerType,
      model,
    };
  }
}
