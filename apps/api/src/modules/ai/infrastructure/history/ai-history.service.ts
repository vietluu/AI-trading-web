import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../database/prisma.service";
import { AIHistoryDto, AIProviderType } from "@platform/shared";
import { AIHistory } from "@prisma/client";

export interface LogAIExecutionParams {
  userId: string;
  sessionId?: string;
  provider: AIProviderType;
  model: string;
  prompt: string;
  systemPrompt?: string;
  response: string;
  responseJson?: Record<string, unknown> | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  latencyMs: number;
  success: boolean;
  finishReason?: string;
  error?: string;
}

@Injectable()
export class AIHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  private sanitizeSecrets(text: string): string {
    if (!text) return "";
    return text
      .replace(/sk-[a-zA-Z0-9_-]{20,}/g, "sk-***[REDACTED]***")
      .replace(/AIza[a-zA-Z0-9_-]{30,}/g, "AIza***[REDACTED]***")
      .replace(/secret_[a-zA-Z0-9_-]{20,}/g, "secret_***[REDACTED]***");
  }

  public async logExecution(params: LogAIExecutionParams): Promise<AIHistory> {
    return this.prisma.aIHistory.create({
      data: {
        userId: params.userId,
        sessionId: params.sessionId,
        provider: params.provider,
        model: params.model,
        prompt: this.sanitizeSecrets(params.prompt),
        systemPrompt: params.systemPrompt ? this.sanitizeSecrets(params.systemPrompt) : undefined,
        response: this.sanitizeSecrets(params.response),
        responseJson: params.responseJson as object || undefined,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens: params.totalTokens,
        estimatedCost: params.estimatedCost,
        latencyMs: params.latencyMs,
        success: params.success,
        finishReason: params.finishReason,
        error: params.error ? this.sanitizeSecrets(params.error) : undefined,
      },
    });
  }

  public async getHistoryForUser(userId: string, limit = 50): Promise<AIHistoryDto[]> {
    const records = await this.prisma.aIHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return records.map((r) => ({
      id: r.id,
      provider: r.provider,
      model: r.model,
      prompt: r.prompt,
      systemPrompt: r.systemPrompt,
      response: r.response,
      responseJson: r.responseJson as Record<string, unknown> | null,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
      estimatedCost: Number(r.estimatedCost),
      latencyMs: r.latencyMs,
      success: r.success,
      finishReason: r.finishReason,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
