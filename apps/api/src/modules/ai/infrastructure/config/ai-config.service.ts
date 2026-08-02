import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../database/prisma.service";
import { AIConfigDto, UpdateAIConfigDto } from "@platform/shared";
import { AIConfiguration, AIProviderType } from "@prisma/client";

@Injectable()
export class AIConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  public async getOrCreateConfig(userId: string): Promise<AIConfiguration> {
    const existing = await this.prisma.aIConfiguration.findUnique({
      where: { userId },
    });
    if (existing) return existing;

    return this.prisma.aIConfiguration.create({
      data: {
        userId,
        preferredProvider:
          this.config.get<AIProviderType>("DEFAULT_PROVIDER") ?? "OPENAI",
        preferredModel:
          this.config.get<string>("DEFAULT_MODEL") ?? "openai/gpt-oss-20b:free",
        temperature: 0.7,
        maxTokens: 2048,
        timeoutMs: 30000,
        dailyBudget: 10.0,
        monthlyBudget: 100.0,
        tokenBudget: 1000000,
        requestBudget: 1000,
        fallbackEnabled: true,
        fallbackProviders: ["ANTHROPIC", "GEMINI", "OLLAMA"],
      },
    });
  }

  public async updateConfig(userId: string, dto: UpdateAIConfigDto): Promise<AIConfiguration> {
    await this.getOrCreateConfig(userId);

    return this.prisma.aIConfiguration.update({
      where: { userId },
      data: {
        preferredProvider: dto.preferredProvider,
        preferredModel: dto.preferredModel,
        temperature: dto.temperature,
        maxTokens: dto.maxTokens,
        timeoutMs: dto.timeoutMs,
        dailyBudget: dto.dailyBudget !== undefined ? dto.dailyBudget : undefined,
        monthlyBudget: dto.monthlyBudget !== undefined ? dto.monthlyBudget : undefined,
        tokenBudget: dto.tokenBudget,
        requestBudget: dto.requestBudget,
        fallbackEnabled: dto.fallbackEnabled,
        fallbackProviders: dto.fallbackProviders,
      },
    });
  }

  public toSharedDto(config: AIConfiguration): AIConfigDto {
    return {
      preferredProvider: config.preferredProvider,
      preferredModel: config.preferredModel,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs,
      dailyBudget: Number(config.dailyBudget),
      monthlyBudget: Number(config.monthlyBudget),
      tokenBudget: config.tokenBudget,
      requestBudget: config.requestBudget,
      fallbackEnabled: config.fallbackEnabled,
      fallbackProviders: config.fallbackProviders as ("OPENAI" | "ANTHROPIC" | "GEMINI" | "OLLAMA")[],
    };
  }
}
