import { Injectable } from "@nestjs/common";

@Injectable()
export class TokenCounterService {
  /**
   * Provider independent token count calculation.
   * Standard estimation: ~4 characters per token for English & JSON code.
   */
  public countTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  public estimateBreakdown(params: {
    systemPrompt?: string;
    userPrompt: string;
    context?: string;
    expectedOutputMaxTokens?: number;
  }): {
    promptTokens: number;
    contextTokens: number;
    systemTokens: number;
    totalInputTokens: number;
    estimatedOutputTokens: number;
    totalTokens: number;
  } {
    const systemTokens = this.countTokens(params.systemPrompt || "");
    const promptTokens = this.countTokens(params.userPrompt);
    const contextTokens = this.countTokens(params.context || "");
    const totalInputTokens = systemTokens + promptTokens + contextTokens;
    const estimatedOutputTokens = params.expectedOutputMaxTokens || 512;
    const totalTokens = totalInputTokens + estimatedOutputTokens;

    return {
      promptTokens,
      contextTokens,
      systemTokens,
      totalInputTokens,
      estimatedOutputTokens,
      totalTokens,
    };
  }
}
