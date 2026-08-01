import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../database/prisma.service";
import type { ToolResult } from "../../domain/contracts/tool-result.contract";
import type { ToolExecutionContext } from "../../domain/contracts/tool-context.contract";
import { createHash } from "node:crypto";
import { Prisma, ToolInvocationRecord } from "@prisma/client";

@Injectable()
export class ToolInvocationRepository {
  private readonly logger = new Logger(ToolInvocationRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  public async saveInvocationRecord(
    toolName: string,
    toolVersion: number,
    rawInput: unknown,
    result: ToolResult,
    context: ToolExecutionContext
  ): Promise<ToolInvocationRecord> {
    const inputHash = createHash("sha256")
      .update(JSON.stringify(rawInput || {}))
      .digest("hex");

    const resultSizeBytes = result.data ? Buffer.byteLength(JSON.stringify(result.data)) : 0;
    const estimatedTokens = Math.ceil(resultSizeBytes / 4);

    return this.prisma.toolInvocationRecord.create({
      data: {
        invocationId: result.invocationId,
        userId: context.userId || null,
        agentRunId: context.agentRunId || null,
        aiRequestId: context.aiRequestId || null,
        provider: context.provider || null,
        model: context.model || null,
        toolName,
        toolVersion,
        invocationSource: context.source,
        inputHash,
        sanitizedInput: rawInput
          ? (JSON.parse(JSON.stringify(rawInput)) as Prisma.InputJsonValue)
          : Prisma.DbNull,
        status: result.status,
        startedAt: result.metadata.startedAt,
        completedAt: result.metadata.completedAt,
        durationMs: result.metadata.durationMs,
        cached: result.metadata.cached,
        errorCode: result.error?.code || null,
        errorMessage: result.error?.message || null,
        policyVersion: 1,
        resultSizeBytes,
        estimatedResultTokens: estimatedTokens,
        traceId: context.traceId,
        correlationId: context.correlationId,
      },
    });
  }

  public async getHistory(userId?: string, limit = 50, toolName?: string): Promise<ToolInvocationRecord[]> {
    return this.prisma.toolInvocationRecord.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(toolName ? { toolName } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
