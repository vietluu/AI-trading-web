import { Injectable } from "@nestjs/common";
import { LLMProviderFactory } from "../provider/llm-provider.factory";
import { AIProviderHealth } from "@platform/shared";

@Injectable()
export class AIEvaluationService {
  constructor(private readonly providerFactory: LLMProviderFactory) {}

  public async evaluateHealth(): Promise<AIProviderHealth[]> {
    const providers = this.providerFactory.getAllProviders();
    const results: AIProviderHealth[] = [];

    for (const provider of providers) {
      const h = await provider.health();
      results.push({
        provider: h.provider,
        status: h.status,
        latencyMs: h.latencyMs,
        lastSuccessAt: h.lastSuccessAt ? h.lastSuccessAt.toISOString() : null,
        lastError: h.lastError,
        models: h.models,
      });
    }

    return results;
  }
}
