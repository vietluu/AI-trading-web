import { Injectable, Logger } from "@nestjs/common";
import type { ToolResult } from "../../domain/contracts/tool-result.contract";
import type { ToolExecutionContext } from "../../domain/contracts/tool-context.contract";
import { ToolRegistryService } from "../registry/tool-registry.service";
import { ToolPolicyEngine } from "../policies/tool-policy.engine";
import { ToolArgumentValidator } from "../sanitization/argument-validator";
import { ToolResultSanitizer } from "../sanitization/result-sanitizer";
import { ToolInvocationRepository } from "../persistence/tool-invocation.repository";
import { ToolIdempotencyService } from "../redis/tool-idempotency.service";
import { ToolRateLimiterService } from "../redis/tool-rate-limiter.service";
import { ToolLoopGuard } from "../policies/tool-loop.guard";

import type { ToolErrorCode } from "@platform/shared";

@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly policyEngine: ToolPolicyEngine,
    private readonly validator: ToolArgumentValidator,
    private readonly sanitizer: ToolResultSanitizer,
    private readonly repository: ToolInvocationRepository,
    private readonly idempotencyService: ToolIdempotencyService,
    private readonly rateLimiter: ToolRateLimiterService,
    private readonly loopGuard: ToolLoopGuard,
  ) {}

  public async execute(
    toolName: string,
    rawArgs: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const startedAt = new Date();
    const tool = this.registry.resolveByName(toolName);

    if (!tool) {
      return this.buildErrorResult(
        context.invocationId,
        toolName,
        1,
        startedAt,
        "TOOL_NOT_FOUND",
        `Tool '${toolName}' is not registered`,
      );
    }

    // 1. Policy Evaluation
    const policyDecision = this.policyEngine.evaluate(tool, context);
    if (policyDecision.status === "DENY") {
      this.logger.warn(
        `Policy DENIED tool execution '${toolName}': ${policyDecision.reasons.join("; ")}`,
      );
      return this.buildErrorResult(
        context.invocationId,
        tool.name,
        tool.version,
        startedAt,
        "TOOL_CAPABILITY_DENIED",
        `Policy denied: ${policyDecision.reasons.join("; ")}`,
      );
    }

    // 2. User Rate Limit Check
    if (context.userId) {
      const rateCheck = await this.rateLimiter.checkUserRateLimit(
        context.userId,
        context.source,
      );
      if (!rateCheck.allowed) {
        return this.buildErrorResult(
          context.invocationId,
          tool.name,
          tool.version,
          startedAt,
          "TOOL_RATE_LIMITED",
          "Tool execution rate limit exceeded for user",
        );
      }
    }

    // 3. Argument Validation
    const validation = this.validator.validateAndParse(tool, rawArgs);
    if (!validation.success || !validation.data) {
      return this.buildErrorResult(
        context.invocationId,
        tool.name,
        tool.version,
        startedAt,
        "TOOL_ARGUMENT_INVALID",
        validation.error || "Invalid arguments",
      );
    }

    // 4. Idempotency Check for Read-Only / Short TTL Tools
    const fingerprint = this.loopGuard.calculateFingerprint(
      tool.name,
      validation.data,
    );
    if (tool.cachePolicy.type !== "NONE") {
      const cached = await this.idempotencyService.getCachedResult(fingerprint);
      if (cached) {
        this.logger.log(
          `Returning cached tool result for '${tool.name}' (fingerprint: ${fingerprint})`,
        );
        return {
          ...cached,
          invocationId: context.invocationId,
          metadata: { ...cached.metadata, cached: true },
        };
      }
    }

    // 5. Execution with Timeout
    let rawOutput: unknown;
    let executionSuccess = false;
    let errorMessage: string | undefined;

    try {
      const timeoutMs = tool.timeoutMs || 10000;
      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Tool execution timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });

      try {
        rawOutput = await Promise.race([
          tool.execute(validation.data, context),
          timeoutPromise,
        ]);
        executionSuccess = true;
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Execution error in tool '${tool.name}': ${errorMessage}`,
      );
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    if (!executionSuccess) {
      const isTimeout = errorMessage?.includes("timed out");
      const errResult = this.buildErrorResult(
        context.invocationId,
        tool.name,
        tool.version,
        startedAt,
        isTimeout ? "TOOL_TIMEOUT" : "TOOL_EXECUTION_FAILED",
        errorMessage || "Execution failed",
      );

      this.registry.recordHealthTelemetry(
        tool.name,
        durationMs,
        false,
        errorMessage,
      );
      await this.repository.saveInvocationRecord(
        tool.name,
        tool.version,
        validation.data,
        errResult,
        context,
      );
      return errResult;
    }

    // 6. Result Sanitization (Redact Secrets & Enforce Size Bounds)
    if (this.sanitizer.containsSecrets(rawOutput)) {
      this.logger.warn(
        `Secret pattern detected in output of tool '${tool.name}'. Redacting content.`,
      );
    }
    const sanitizedOutput = this.sanitizer.sanitize(rawOutput);

    const successResult: ToolResult = {
      invocationId: context.invocationId,
      toolName: tool.name,
      toolVersion: tool.version,
      status: "SUCCESS",
      data: sanitizedOutput,
      metadata: {
        startedAt,
        completedAt,
        durationMs,
        cached: false,
        stale: false,
        schemaVersion: tool.version,
      },
    };

    // Cache if tool policy permits
    if (
      tool.cachePolicy.type === "SHORT_TTL" ||
      tool.cachePolicy.type === "REQUEST_SCOPE"
    ) {
      await this.idempotencyService.setCachedResult(
        fingerprint,
        successResult,
        tool.cachePolicy.ttlSeconds || 10,
      );
    }

    this.registry.recordHealthTelemetry(tool.name, durationMs, true);
    await this.repository.saveInvocationRecord(
      tool.name,
      tool.version,
      validation.data,
      successResult,
      context,
    );

    return successResult;
  }

  private buildErrorResult(
    invocationId: string,
    toolName: string,
    toolVersion: number,
    startedAt: Date,
    code: ToolErrorCode,
    message: string,
  ): ToolResult {
    const completedAt = new Date();
    return {
      invocationId,
      toolName,
      toolVersion,
      status:
        code === "TOOL_CAPABILITY_DENIED"
          ? "DENIED"
          : code === "TOOL_TIMEOUT"
            ? "TIMED_OUT"
            : "FAILED",
      error: {
        code,
        message,
        retryable:
          code === "TOOL_TIMEOUT" || code === "TOOL_DEPENDENCY_UNAVAILABLE",
      },
      metadata: {
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        cached: false,
        stale: false,
        schemaVersion: toolVersion,
      },
    };
  }
}
