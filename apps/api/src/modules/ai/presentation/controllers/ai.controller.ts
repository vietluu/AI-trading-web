import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  AIConfigDto,
  AIHistoryDto,
  AIModel,
  AIProviderHealth,
  AIResponseDto,
  AIUsageDto,
  UpdateAIConfigDto,
} from "@platform/shared";
import { Response } from "express";
import { SessionGuard } from "../../../../session/session.guard";
import { CurrentUser } from "../../../../common/decorators/current-user.decorator";
import { User } from "@prisma/client";
import { AIOrchestratorService } from "../../application/ai-orchestrator.service";
import { AIConfigService } from "../../infrastructure/config/ai-config.service";
import { AIEvaluationService } from "../../infrastructure/evaluation/ai-evaluator.service";
import { AIHistoryService } from "../../infrastructure/history/ai-history.service";
import { ModelRegistryService } from "../../infrastructure/registry/model-registry.service";
import { BudgetManagerService } from "../../infrastructure/budget/budget-manager.service";
import { PrismaService } from "../../../../database/prisma.service";

@ApiTags("AI Infrastructure")
@Controller("ai")
@UseGuards(SessionGuard)
export class AIController {
  constructor(
    private readonly orchestrator: AIOrchestratorService,
    private readonly configService: AIConfigService,
    private readonly historyService: AIHistoryService,
    private readonly evaluationService: AIEvaluationService,
    private readonly modelRegistry: ModelRegistryService,
    private readonly budgetManager: BudgetManagerService,
    private readonly prisma: PrismaService
  ) {}

  @Get("providers")
  @ApiOperation({ summary: "Get AI Providers and their health status" })
  @ApiResponse({ status: 200, description: "List of providers and health status" })
  public async getProviders(): Promise<AIProviderHealth[]> {
    return this.evaluationService.evaluateHealth();
  }

  @Get("models")
  @ApiOperation({ summary: "Get all registered AI Models" })
  @ApiResponse({ status: 200, description: "List of AI Models" })
  public getModels(): Promise<AIModel[]> {
    const models = this.modelRegistry.getAllModels();
    return Promise.resolve(models.map((m) => this.modelRegistry.toSharedModelDto(m)));
  }

  @Get("history")
  @ApiOperation({ summary: "Get AI execution history for the current user" })
  @ApiResponse({ status: 200, description: "User AI history" })
  public async getHistory(
    @CurrentUser() user: User,
    @Query("limit") limit?: string
  ): Promise<AIHistoryDto[]> {
    const take = limit ? Math.min(Number(limit), 100) : 50;
    return this.historyService.getHistoryForUser(user.id, take);
  }

  @Get("config")
  @ApiOperation({ summary: "Get AI configuration for the current user" })
  @ApiResponse({ status: 200, description: "User AI Configuration" })
  public async getConfig(@CurrentUser() user: User): Promise<AIConfigDto> {
    const config = await this.configService.getOrCreateConfig(user.id);
    return this.configService.toSharedDto(config);
  }

  @Put("config")
  @ApiOperation({ summary: "Update AI configuration for the current user" })
  @ApiResponse({ status: 200, description: "Updated AI Configuration" })
  public async updateConfig(
    @CurrentUser() user: User,
    @Body() dto: UpdateAIConfigDto
  ): Promise<AIConfigDto> {
    const updated = await this.configService.updateConfig(user.id, dto);
    return this.configService.toSharedDto(updated);
  }

  @Post("test")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Test AI execution prompt and structured response" })
  @ApiResponse({ status: 200, description: "AI Response" })
  public async testAI(
    @CurrentUser() user: User,
    @Body()
    body: {
      prompt: string;
      systemPrompt?: string;
      provider?: "OPENAI" | "ANTHROPIC" | "GEMINI" | "OLLAMA";
      model?: string;
      responseFormat?: "text" | "json";
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<AIResponseDto> {
    return this.orchestrator.execute({
      userId: user.id,
      userPrompt: body.prompt,
      systemPrompt: body.systemPrompt,
      provider: body.provider,
      model: body.model,
      responseFormat: body.responseFormat,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
    });
  }

  @Get("usage")
  @ApiOperation({ summary: "Get daily AI token usage and budget status" })
  @ApiResponse({ status: 200, description: "AI Usage and budget status" })
  public async getUsage(@CurrentUser() user: User): Promise<AIUsageDto> {
    const todayStr = new Date().toISOString().slice(0, 10);
    const config = await this.configService.getOrCreateConfig(user.id);
    const todayUsage = await this.prisma.aIUsage.findUnique({
      where: { userId_date: { userId: user.id, date: todayStr } },
    });

    const dailyLimit = Number(config.dailyBudget);
    const dailyCost = todayUsage ? Number(todayUsage.totalCost) : 0;
    const remaining = Math.max(0, dailyLimit - dailyCost);
    const isBlocked = dailyCost >= dailyLimit;

    return {
      date: todayStr,
      requestCount: todayUsage?.requestCount || 0,
      promptTokens: todayUsage?.promptTokens || 0,
      completionTokens: todayUsage?.completionTokens || 0,
      totalTokens: todayUsage?.totalTokens || 0,
      totalCost: dailyCost,
      dailyBudget: dailyLimit,
      budgetRemaining: remaining,
      isBlocked,
    };
  }

  @Post("chat/stream")
  @ApiOperation({ summary: "Stream AI completion response using Server-Sent Events" })
  public async streamChat(
    @CurrentUser() user: User,
    @Body() body: { prompt: string; systemPrompt?: string; provider?: "OPENAI" | "ANTHROPIC" | "GEMINI" | "OLLAMA"; model?: string },
    @Res() res: Response
  ): Promise<void> {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const stream = this.orchestrator.stream({
        userId: user.id,
        userPrompt: body.prompt,
        systemPrompt: body.systemPrompt,
        provider: body.provider,
        model: body.model,
      });

      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    }
  }
}
