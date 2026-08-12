import { Injectable } from "@nestjs/common";
import { AIModel, AIProviderType } from "@platform/shared";
import { LLMModelInfo } from "../../domain/interfaces/llm-provider.interface";

@Injectable()
export class ModelRegistryService {
  private readonly models: Map<string, LLMModelInfo> = new Map();

  constructor() {
    this.registerDefaultModels();
  }

  private registerDefaultModels(): void {
    // OpenAI Models
    this.registerModel({
      name: "gpt-5.5",
      displayName: "GPT-5.5 (Flagship)",
      provider: "OPENAI",
      contextWindow: 200000,
      maxOutput: 16384,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0.003,
      outputCostPer1k: 0.012,
    });

    this.registerModel({
      name: "gpt-5-mini",
      displayName: "GPT-5 Mini (Fast & Efficient)",
      provider: "OPENAI",
      contextWindow: 128000,
      maxOutput: 16384,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0.00015,
      outputCostPer1k: 0.0006,
    });

    this.registerModel({
      name: "gpt-4o",
      displayName: "GPT-4o (Omni)",
      provider: "OPENAI",
      contextWindow: 128000,
      maxOutput: 4096,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0.0025,
      outputCostPer1k: 0.01,
    });

    // Anthropic Claude Models
    this.registerModel({
      name: "claude-3-7-sonnet-20250219",
      displayName: "Claude 3.7 Sonnet",
      provider: "ANTHROPIC",
      contextWindow: 200000,
      maxOutput: 8192,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0.003,
      outputCostPer1k: 0.015,
    });

    this.registerModel({
      name: "claude-3-5-sonnet-20241022",
      displayName: "Claude 3.5 Sonnet",
      provider: "ANTHROPIC",
      contextWindow: 200000,
      maxOutput: 8192,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0.003,
      outputCostPer1k: 0.015,
    });

    this.registerModel({
      name: "claude-3-opus-20240229",
      displayName: "Claude 3 Opus",
      provider: "ANTHROPIC",
      contextWindow: 200000,
      maxOutput: 4096,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0.015,
      outputCostPer1k: 0.075,
    });

    // Google Gemini Models
    this.registerModel({
      name: "gemini-3.6-flash",
      displayName: "Gemini 3.6 Flash",
      provider: "GEMINI",
      contextWindow: 1048576,
      maxOutput: 65536,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0.000075,
      outputCostPer1k: 0.0003,
    });

    this.registerModel({
      name: "gemini-3.5-flash",
      displayName: "Gemini 3.5 Flash",
      provider: "GEMINI",
      contextWindow: 1048576,
      maxOutput: 65536,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0.000075,
      outputCostPer1k: 0.0003,
    });

    this.registerModel({
      name: "gemini-3.5-flash-lite",
      displayName: "Gemini 3.5 Flash Lite",
      provider: "GEMINI",
      contextWindow: 1048576,
      maxOutput: 65536,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    });

    this.registerModel({
      name: "gemini-3.1-flash-lite",
      displayName: "Gemini 3.1 Flash Lite",
      provider: "GEMINI",
      contextWindow: 1048576,
      maxOutput: 65536,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    });

    this.registerModel({
      name: "gemini-3-flash",
      displayName: "Gemini 3 Flash",
      provider: "GEMINI",
      contextWindow: 1048576,
      maxOutput: 65536,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0.000075,
      outputCostPer1k: 0.0003,
    });

    this.registerModel({
      name: "gemini-2.5-flash",
      displayName: "Gemini 2.5 Flash",
      provider: "GEMINI",
      contextWindow: 1048576,
      maxOutput: 8192,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0.000075,
      outputCostPer1k: 0.0003,
    });

    this.registerModel({
      name: "gemini-2.5-flash-lite",
      displayName: "Gemini 2.5 Flash Lite",
      provider: "GEMINI",
      contextWindow: 1048576,
      maxOutput: 8192,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    });

    this.registerModel({
      name: "gemini-2.0-flash",
      displayName: "Gemini 2.0 Flash",
      provider: "GEMINI",
      contextWindow: 1048576,
      maxOutput: 8192,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0.0001,
      outputCostPer1k: 0.0004,
    });

    this.registerModel({
      name: "gemini-1.5-flash",
      displayName: "Gemini 1.5 Flash",
      provider: "GEMINI",
      contextWindow: 1048576,
      maxOutput: 8192,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0.000075,
      outputCostPer1k: 0.0003,
    });

    this.registerModel({
      name: "gemini-1.5-pro",
      displayName: "Gemini 1.5 Pro",
      provider: "GEMINI",
      contextWindow: 1000000,
      maxOutput: 8192,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0.00125,
      outputCostPer1k: 0.005,
    });

    // Ollama Local Models
    this.registerModel({
      name: "llama3",
      displayName: "Llama 3 (8B Local)",
      provider: "OLLAMA",
      contextWindow: 8192,
      maxOutput: 4096,
      supportsTools: false,
      supportsVision: false,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    });

    this.registerModel({
      name: "qwen",
      displayName: "Qwen 2.5 (Local)",
      provider: "OLLAMA",
      contextWindow: 32768,
      maxOutput: 4096,
      supportsTools: true,
      supportsVision: false,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    });

    this.registerModel({
      name: "deepseek",
      displayName: "DeepSeek Coder / R1 (Local)",
      provider: "OLLAMA",
      contextWindow: 65536,
      maxOutput: 8192,
      supportsTools: true,
      supportsVision: false,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    });

    this.registerModel({
      name: "mistral",
      displayName: "Mistral 7B (Local)",
      provider: "OLLAMA",
      contextWindow: 32768,
      maxOutput: 4096,
      supportsTools: false,
      supportsVision: false,
      supportsStreaming: true,
      supportsJSON: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    });
  }

  public registerModel(info: LLMModelInfo): void {
    this.models.set(info.name, info);
  }

  public getModel(modelName: string): LLMModelInfo | undefined {
    return this.models.get(modelName);
  }

  public getModelsByProvider(provider: AIProviderType): LLMModelInfo[] {
    return Array.from(this.models.values()).filter(
      (m) => m.provider === provider
    );
  }

  public getAllModels(): LLMModelInfo[] {
    return Array.from(this.models.values());
  }

  public toSharedModelDto(info: LLMModelInfo, isDefault = false): AIModel {
    return {
      provider: info.provider,
      name: info.name,
      displayName: info.displayName,
      contextWindow: info.contextWindow,
      maxOutput: info.maxOutput,
      capabilities: {
        supportsTools: info.supportsTools,
        supportsVision: info.supportsVision,
        supportsStreaming: info.supportsStreaming,
        supportsJSON: info.supportsJSON,
      },
      pricing: {
        inputCostPer1k: info.inputCostPer1k,
        outputCostPer1k: info.outputCostPer1k,
      },
      isDefault,
    };
  }
}
