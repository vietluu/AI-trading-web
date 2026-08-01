import type { AIProviderType, ProviderHealthStatus } from "@platform/shared";

export interface LLMChatMessage {
  role: "system" | "user" | "assistant" | "developer";
  content: string;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMRequestOptions {
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  messages?: LLMChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  jsonSchema?: Record<string, unknown>;
  tools?: LLMToolDefinition[];
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface LLMResponseUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface LLMResponse {
  text: string;
  json: Record<string, unknown> | null;
  finishReason: string;
  usage: LLMResponseUsage;
  latencyMs: number;
  provider: AIProviderType;
  model: string;
}

export interface LLMStreamChunk {
  deltaToken: string;
  isComplete: boolean;
  finishReason?: string;
  usage?: LLMResponseUsage;
}

export interface LLMProviderHealth {
  provider: AIProviderType;
  status: ProviderHealthStatus;
  latencyMs: number;
  lastSuccessAt: Date | null;
  lastError: string | null;
  models: string[];
}

export interface LLMModelInfo {
  name: string;
  displayName: string;
  provider: AIProviderType;
  contextWindow: number;
  maxOutput: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsJSON: boolean;
  inputCostPer1k: number;
  outputCostPer1k: number;
}

export interface LLMProvider {
  readonly providerType: AIProviderType;

  chat(options: LLMRequestOptions): Promise<LLMResponse>;
  stream(options: LLMRequestOptions): AsyncIterable<LLMStreamChunk>;
  embedding(text: string): Promise<number[]>;
  countTokens(text: string, model?: string): Promise<number>;
  health(): Promise<LLMProviderHealth>;
  listModels(): Promise<LLMModelInfo[]>;
}
