import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SessionGuard } from "../../../../session/session.guard";
import { CurrentUser } from "../../../../common/decorators/current-user.decorator";
import { ToolInvocationService } from "../../application/tool-invocation.service";
import { ToolHealthService } from "../../application/tool-health.service";
import { ToolRegistryService } from "../../infrastructure/registry/tool-registry.service";
import type { ToolExecutionContext } from "../../domain/contracts/tool-context.contract";
import { randomUUID } from "node:crypto";

@ApiTags("AI Tools")
@Controller("ai/tools")
@UseGuards(SessionGuard)
export class AIToolsController {
  constructor(
    private readonly invocationService: ToolInvocationService,
    private readonly healthService: ToolHealthService,
    private readonly registry: ToolRegistryService
  ) {}

  @Get()
  @ApiOperation({ summary: "List registered AI tools" })
  @ApiResponse({ status: 200, description: "List of registered AI tools" })
  public listTools() {
    return this.invocationService.listTools();
  }

  @Get("health")
  @ApiOperation({ summary: "Get AI tools health and telemetry" })
  @ApiResponse({ status: 200, description: "Tool health and latency telemetry" })
  public getHealth() {
    return this.healthService.getHealthStatus();
  }

  @Get("categories")
  @ApiOperation({ summary: "List supported tool categories" })
  public getCategories() {
    return this.healthService.getCategories();
  }

  @Get("capabilities")
  @ApiOperation({ summary: "List available agent tool capabilities" })
  public getCapabilities() {
    return this.healthService.getCapabilities();
  }

  @Get("history")
  @ApiOperation({ summary: "Get tool invocation history" })
  public async getHistory(
    @CurrentUser() user: { id: string },
    @Query("limit") limit?: string,
    @Query("toolName") toolName?: string
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.invocationService.getHistory(user.id, limitNum, toolName);
  }

  @Get(":name")
  @ApiOperation({ summary: "Get detailed tool schema definition by name" })
  public getToolByName(@Param("name") name: string) {
    const tool = this.registry.resolveByName(name);
    if (!tool) {
      throw new NotFoundException(`Tool '${name}' is not registered`);
    }
    const canonical = this.registry.getCanonicalSchema(tool);
    return {
      name: tool.name,
      version: tool.version,
      displayName: tool.displayName,
      description: tool.description,
      category: tool.category,
      sensitivity: tool.sensitivity,
      sideEffect: tool.sideEffect,
      status: tool.status,
      requiresAuthentication: tool.requiresAuthentication,
      userScoped: tool.userScoped,
      requiredCapabilities: tool.requiredCapabilities,
      schemaHash: tool.schemaHash,
      canonicalSchema: canonical,
    };
  }

  @Post(":name/test")
  @ApiOperation({ summary: "Manual test execution of read-only AI tool" })
  public async testTool(
    @Param("name") name: string,
    @CurrentUser() user: { id: string },
    @Body() body: Record<string, unknown>
  ) {
    if (process.env.NODE_ENV === "production" && process.env.AI_TOOL_MANUAL_TEST_ENABLED !== "true") {
      throw new ForbiddenException("Manual tool test execution is disabled in production environment");
    }

    const context: ToolExecutionContext = {
      invocationId: `test-${randomUUID()}`,
      traceId: `tr-${randomUUID()}`,
      correlationId: `cr-${randomUUID()}`,
      userId: user.id,
      requestedAt: new Date(),
      deadlineAt: new Date(Date.now() + 10000),
      source: "REST_DEBUG",
      capabilities: [
        "READ_MARKET_DATA",
        "READ_INDICATORS",
        "READ_NEWS",
        "READ_SENTIMENT",
        "READ_MACRO",
        "READ_SOCIAL",
        "READ_USER_SETTINGS",
        "READ_USER_EXCHANGE_ACCOUNT",
      ],
      safeMetadata: {},
    };

    return this.invocationService.invokeTool(name, body || {}, context);
  }
}
