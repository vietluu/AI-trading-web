import { ForbiddenException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../database/prisma.service";
import { AIConfigDto, UpdateAIConfigDto } from "@platform/shared";
import { AIConfiguration, AIProviderType } from "@prisma/client";

@Injectable()
export class AIConfigService {
  private systemIdentity?: Promise<string>;

  public getSystemUserId(): Promise<string> {
    if (!this.systemIdentity) {
      const id = '00000000-0000-4000-8000-000000000001';
      this.systemIdentity = this.prisma.user.upsert({
        where: { id },
        create: {
          id, email: 'research@platform.invalid', username: '__platform_research__',
          passwordHash: '!DISABLED_SYSTEM_ACCOUNT!', lockedUntil: new Date('9999-01-01'),
        },
        update: {},
      }).then(() => id).catch((error) => {
        this.systemIdentity = undefined;
        throw error;
      });
    }
    return this.systemIdentity;
  }

  private platformDefaults() {
    return {
      preferredProvider: 'GEMINI' as AIProviderType,
      preferredModel: 'gemini-3.1-flash-lite',
      temperature: this.config.get<number>('DEFAULT_TEMPERATURE') ?? 0.7,
      maxTokens: this.config.get<number>('DEFAULT_MAX_TOKENS') ?? 2048,
      timeoutMs: this.config.get<number>('DEFAULT_TIMEOUT') ?? 30000,
      fallbackEnabled: false, fallbackProviders: [] as string[],
    };
  }
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  public async getOrCreateConfig(userId: string): Promise<AIConfiguration> {
    const existing = await this.prisma.aIConfiguration.findUnique({
      where: { userId },
    });

    if (existing) {
      return { ...existing, ...this.platformDefaults() };
    }

    return this.prisma.aIConfiguration.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        dailyBudget: 10.0,
        monthlyBudget: 100.0,
        tokenBudget: 0,
        requestBudget: 5000,
        ...this.platformDefaults(),
      },
    });
  }

  public updateConfig(
    _userId: string,
    _dto: UpdateAIConfigDto,
  ): Promise<AIConfiguration> {
    void _userId;
    void _dto;
    return Promise.reject(new ForbiddenException('AI configuration is managed by the platform'));
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
      fallbackProviders: config.fallbackProviders as (
        "OPENAI" | "ANTHROPIC" | "GEMINI" | "OLLAMA"
      )[],
    };
  }
}
