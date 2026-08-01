import { Injectable, Logger } from "@nestjs/common";
import { AIProviderType } from "@platform/shared";
import { LLMProvider } from "../../domain/interfaces/llm-provider.interface";
import { AnthropicProvider } from "./anthropic.provider";
import { GeminiProvider } from "./gemini.provider";
import { OllamaProvider } from "./ollama.provider";
import { OpenAIProvider } from "./openai.provider";

@Injectable()
export class LLMProviderFactory {
  private readonly logger = new Logger(LLMProviderFactory.name);
  private readonly providerMap = new Map<AIProviderType, LLMProvider>();

  constructor(
    private readonly openAIProvider: OpenAIProvider,
    private readonly anthropicProvider: AnthropicProvider,
    private readonly geminiProvider: GeminiProvider,
    private readonly ollamaProvider: OllamaProvider
  ) {
    this.providerMap.set("OPENAI", this.openAIProvider);
    this.providerMap.set("ANTHROPIC", this.anthropicProvider);
    this.providerMap.set("GEMINI", this.geminiProvider);
    this.providerMap.set("OLLAMA", this.ollamaProvider);
  }

  public getProvider(type: AIProviderType): LLMProvider {
    const provider = this.providerMap.get(type);
    if (!provider) {
      throw new Error(`Unsupported LLM Provider: ${type}`);
    }
    return provider;
  }

  public getAllProviders(): LLMProvider[] {
    return Array.from(this.providerMap.values());
  }

  public async getAvailableProvider(preferred: AIProviderType, fallbacks: AIProviderType[]): Promise<LLMProvider> {
    const candidateTypes = [preferred, ...fallbacks];
    for (const type of candidateTypes) {
      try {
        const provider = this.getProvider(type);
        const health = await provider.health();
        if (health.status === "HEALTHY" || health.status === "DEGRADED" || process.env.NODE_ENV === "test") {
          return provider;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Provider ${type} is unavailable for fallback: ${msg}`);
      }
    }
    return this.getProvider(preferred);
  }
}
