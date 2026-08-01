import { Injectable } from "@nestjs/common";
import { ModelRegistryService } from "../registry/model-registry.service";

@Injectable()
export class CostEstimatorService {
  constructor(private readonly modelRegistry: ModelRegistryService) {}

  public calculateCost(
    modelName: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const model = this.modelRegistry.getModel(modelName);
    if (!model) {
      // Fallback default pricing
      return (inputTokens / 1000) * 0.0015 + (outputTokens / 1000) * 0.006;
    }
    const inputCost = (inputTokens / 1000) * model.inputCostPer1k;
    const outputCost = (outputTokens / 1000) * model.outputCostPer1k;
    return Number((inputCost + outputCost).toFixed(6));
  }
}
