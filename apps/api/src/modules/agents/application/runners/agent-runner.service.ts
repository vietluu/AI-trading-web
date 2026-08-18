import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AIOrchestratorService } from "../../../ai/application/ai-orchestrator.service";
import { AgentRunRepository } from "../../infrastructure/persistence/agent-run.repository";
import { AgentContextBuilderService } from "../context/agent-context-builder.service";
import { AgentPromptResolverService } from "../services/agent-prompt-resolver.service";
import { AgentToolResolverService } from "../services/agent-tool-resolver.service";
import { AgentMemoryResolverService } from "../services/agent-memory-resolver.service";
import { AgentOutputValidatorService } from "../services/agent-output-validator.service";
import { AgentCancellationService } from "../../infrastructure/redis/agent-cancellation.service";
import { AgentConcurrencyService } from "../../infrastructure/redis/agent-concurrency.service";
import { AgentIdempotencyService } from "../../infrastructure/redis/agent-idempotency.service";
import { AgentQuotaService } from "../../infrastructure/redis/agent-quota.service";
import { ToolLoopRunnerService } from "../../../ai-tools/application/tool-loop-runner.service";
import type { AgentDefinition } from "../../domain/models/agent-definition.model";
import {
  AgentInvocationSource,
  AgentRunState,
  AgentType,
} from "../../domain/enums";
import { AgentStateMachine } from "../../domain/state-machine/agent-state-machine";
import { AgentError, AgentErrorCode } from "../../domain/errors/agent-errors";
import { AgentRun, Prisma } from "@prisma/client";
import { PrismaService } from "../../../../database/prisma.service";
import type { AIProviderType, ToolCapability } from "@platform/shared";
import { createHash, randomUUID } from "node:crypto";
import { getAgentOutputContract } from "../../domain/agent-output-contracts";

@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);

  constructor(
    private readonly aiOrchestratorService: AIOrchestratorService,
    private readonly agentRunRepository: AgentRunRepository,
    private readonly agentContextBuilderService: AgentContextBuilderService,
    private readonly agentPromptResolverService: AgentPromptResolverService,
    private readonly agentToolResolverService: AgentToolResolverService,
    private readonly agentMemoryResolverService: AgentMemoryResolverService,
    private readonly agentOutputValidatorService: AgentOutputValidatorService,
    private readonly agentCancellationService: AgentCancellationService,
    private readonly agentConcurrencyService: AgentConcurrencyService,
    private readonly agentIdempotencyService: AgentIdempotencyService,
    private readonly agentQuotaService: AgentQuotaService,
    private readonly toolLoopRunnerService: ToolLoopRunnerService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  public async run(params: {
    definition: AgentDefinition;
    userId?: string;
    sessionId?: string;
    input: Record<string, unknown>;
    invocationSource: AgentInvocationSource;
    correlationId: string;
    parentRunId?: string;
    replayOfRunId?: string;
    existingRunId?: string;
  }): Promise<AgentRun> {
    const { definition, userId, input } = params;

    const inputParseResult = definition.inputSchema.safeParse(input);
    if (!inputParseResult.success) {
      throw new AgentError(
        AgentErrorCode.AGENT_INPUT_INVALID,
        `Input does not match agent schema: ${inputParseResult.error.message}`,
        false,
      );
    }

    const inputString = JSON.stringify(input);
    const inputHash = createHash("sha256").update(inputString).digest("hex");

    // Scheduled and event-driven invocations must always run fresh —
    // returning a cached result from a previous cycle would give stale market
    // data to the decision engine. Include the correlationId so that each
    // pipeline run generates a unique fingerprint for its sub-agent calls.
    const isScheduledInvocation =
      params.invocationSource === AgentInvocationSource.FUTURE_SCHEDULED ||
      params.invocationSource === AgentInvocationSource.FUTURE_EVENT_DRIVEN;

    const idempotencyFingerprint = createHash("sha256")
      .update(
        isScheduledInvocation
          ? `${userId ?? "public"}:${definition.type}:${definition.version}:${inputHash}:${params.correlationId}`
          : `${userId ?? "public"}:${definition.type}:${definition.version}:${inputHash}`,
      )
      .digest("hex");

    const lockResult = await this.agentIdempotencyService.checkAndLock(
      idempotencyFingerprint,
    );
    if (!lockResult.locked) {
      if (
        // Never reuse a cached result for scheduled runs — they need fresh data.
        !isScheduledInvocation &&
        lockResult.existingRunId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          lockResult.existingRunId,
        )
      ) {
        const existingRun = await this.agentRunRepository.findById(
          lockResult.existingRunId,
          userId,
        );
        if (
          existingRun &&
          (existingRun.status === AgentRunState.COMPLETED ||
            existingRun.status === AgentRunState.PARTIALLY_COMPLETED)
        ) {
          return existingRun;
        }
      }
      throw new AgentError(
        AgentErrorCode.AGENT_DUPLICATE_RUN,
        `A run with this input is already in progress (${lockResult.existingRunId || "active"})`,
        false,
      );
    }

    let runRecord: AgentRun;
    try {
      if (params.existingRunId) {
        const existingRun = await this.agentRunRepository.findById(
          params.existingRunId,
          userId,
        );
        if (!existingRun || existingRun.status !== AgentRunState.QUEUED) {
          throw new AgentError(
            AgentErrorCode.AGENT_EXECUTION_FAILED,
            `Queued agent run ${params.existingRunId} was not found or is not executable`,
            false,
          );
        }
        runRecord = existingRun;
      } else {
        runRecord = await this.agentRunRepository.createRun({
          userId,
          agentType: definition.type,
          agentVersion: definition.version,
          invocationSource: params.invocationSource,
          inputHash,
          sanitizedInput: input as Prisma.InputJsonValue,
          promptId: definition.promptId,
          promptVersion: definition.promptVersion,
          traceId: randomUUID(),
          correlationId: params.correlationId,
          parentRunId: params.parentRunId,
          replayOfRunId: params.replayOfRunId,
        });
      }
    } catch (error) {
      await this.agentIdempotencyService.unlock(
        idempotencyFingerprint,
        lockResult.lockToken,
      );
      throw error;
    }

    let globalLockToken: string | undefined;
    let userLockToken: string | undefined;
    let typeLockToken: string | undefined;

    try {
      const gRes = await this.agentConcurrencyService.acquireGlobal();
      if (!gRes.acquired) {
        throw new AgentError(
          AgentErrorCode.AGENT_CONCURRENCY_EXCEEDED,
          "Global concurrency limit reached",
          false,
        );
      }
      globalLockToken = gRes.token;

      if (userId) {
        const uRes = await this.agentConcurrencyService.acquireUser(userId);
        if (!uRes.acquired) {
          throw new AgentError(
            AgentErrorCode.AGENT_CONCURRENCY_EXCEEDED,
            "User concurrency limit reached",
            false,
          );
        }
        userLockToken = uRes.token;
      }

      const tRes = await this.agentConcurrencyService.acquireType(
        definition.type,
      );
      if (!tRes.acquired) {
        throw new AgentError(
          AgentErrorCode.AGENT_CONCURRENCY_EXCEEDED,
          "Agent type concurrency limit reached",
          false,
        );
      }
      typeLockToken = tRes.token;

      runRecord = await this.transitionState(
        runRecord.id,
        runRecord.status,
        AgentRunState.PREPARING_CONTEXT,
        "Context preparation started",
      );

      const validatedInput = inputParseResult.data as Record<string, unknown>;
      const { snapshotId, contextString } =
        await this.agentContextBuilderService.buildAndPersistSnapshot({
          agentDefinition: definition,
          userId,
          symbol:
            typeof validatedInput.symbol === "string"
              ? validatedInput.symbol
              : undefined,
          timeframe:
            typeof validatedInput.interval === "string"
              ? validatedInput.interval
              : undefined,
          provider:
            typeof validatedInput.provider === "string"
              ? validatedInput.provider
              : undefined,
        });

      runRecord = await this.agentRunRepository.updateRun(runRecord.id, {
        contextSnapshotId: snapshotId,
      });

      const memories =
        (await this.agentMemoryResolverService.loadMemory({
          userId,
          memoryPolicy: definition.memoryPolicy,
          agentType: definition.type,
        })) ?? [];
      const memoryContext =
        memories.length > 0
          ? `\nRelevant governed memory:\n${JSON.stringify(memories)}`
          : "";
      const { renderedPrompt } = this.agentPromptResolverService.resolve({
        promptId: definition.promptId,
        promptVersion: definition.promptVersion,
        variables: input,
        contextString: `${contextString}${memoryContext}`,
      });

      runRecord = await this.transitionState(
        runRecord.id,
        runRecord.status,
        AgentRunState.READY,
        "Context and prompt prepared",
      );

      // Agent input `provider` identifies the market/exchange data source, not the LLM.
      const requestedProvider = definition.modelPolicy.preferredProvider as
        AIProviderType | undefined;
      const toolProvider =
        requestedProvider ??
        this.configService?.get<AIProviderType>("DEFAULT_PROVIDER") ??
        "GEMINI";

      const resolvedTools = this.agentToolResolverService.resolveTools({
        allowedToolNames: definition.allowedToolNames,
        requiredCapabilities: definition.requiredCapabilities,
        provider: toolProvider,
      });

      runRecord = await this.transitionState(
        runRecord.id,
        runRecord.status,
        AgentRunState.RUNNING,
        "AI model execution started",
      );

      const startTime = Date.now();
      let toolCallCount = 0;
      let toolRoundCount = 0;
      let usedTools: string[] = [];
      let toolContext = contextString;
      let toolData: Record<string, unknown> = {};

      if (definition.buildToolCalls) {
        const requestedCalls = definition.buildToolCalls(inputParseResult.data);
        const allowedTools = new Set(resolvedTools.resolvedToolNames);
        const uniqueCalls = new Set<string>();

        if (requestedCalls.length > definition.maxToolCalls) {
          throw new AgentError(
            AgentErrorCode.AGENT_TOOL_UNAVAILABLE,
            `Agent requested ${requestedCalls.length} tools; maximum is ${definition.maxToolCalls}`,
            false,
          );
        }

        for (const call of requestedCalls) {
          if (!allowedTools.has(call.toolName)) {
            throw new AgentError(
              AgentErrorCode.AGENT_TOOL_UNAVAILABLE,
              `Agent requested non-allowlisted tool ${call.toolName}`,
              false,
            );
          }
          const fingerprint = `${call.toolName}:${JSON.stringify(call.arguments)}`;
          if (uniqueCalls.has(fingerprint)) {
            throw new AgentError(
              AgentErrorCode.AGENT_TOOL_UNAVAILABLE,
              `Agent requested duplicate tool call ${call.toolName}`,
              false,
            );
          }
          uniqueCalls.add(fingerprint);
        }

        if (requestedCalls.length > 0) {
          runRecord = await this.transitionState(
            runRecord.id,
            runRecord.status,
            AgentRunState.WAITING_FOR_TOOL,
            "Waiting for allowlisted market data tools",
          );

          const step = await this.toolLoopRunnerService.runStep(
            requestedCalls.map((call, index) => ({
              providerCallId: `planned-${index + 1}`,
              toolName: call.toolName,
              arguments: call.arguments,
            })),
            {
              invocationId: runRecord.id,
              traceId: runRecord.traceId || runRecord.id,
              correlationId: params.correlationId,
              userId,
              sessionId: params.sessionId,
              agentRunId: runRecord.id,
              agentType: definition.type,
              requestedAt: new Date(),
              deadlineAt: new Date(Date.now() + definition.timeoutMs),
              source: "INTERNAL_AGENT",
              capabilities: definition.requiredCapabilities as ToolCapability[],
              safeMetadata: {},
            },
            [],
            1,
            definition.maxToolRounds,
          );

          toolCallCount = step.toolResults.length;
          toolRoundCount = 1;
          usedTools = step.toolResults
            .filter(
              ({ result }) =>
                result.status === "SUCCESS" || result.status === "PARTIAL",
            )
            .map(({ toolName }) => toolName);
          toolData = Object.fromEntries(
            step.toolResults
              .filter(
                ({ result }) =>
                  result.status === "SUCCESS" || result.status === "PARTIAL",
              )
              .map(({ toolName, result }) => [toolName, result.data]),
          );
          toolContext = JSON.stringify(
            {
              contextPolicy: {
                candleMaxAgeSeconds:
                  definition.contextPolicy.maximumAgeSecondsBySection
                    .MARKET_CANDLES,
                tickerMaxAgeSeconds:
                  definition.contextPolicy.maximumAgeSecondsBySection
                    .MARKET_TICKER,
              },
              toolResults: step.toolResults.map(({ toolName, result }) => ({
                toolName,
                status: result.status,
                data: result.data,
                error: result.error?.message,
                stale: result.metadata.stale,
              })),
            },
            null,
            2,
          );

          runRecord = await this.transitionState(
            runRecord.id,
            runRecord.status,
            AgentRunState.PROCESSING_TOOL_RESULT,
            "Processing sanitized tool results",
          );
          runRecord = await this.agentRunRepository.updateRun(runRecord.id, {
            toolCallCount,
            toolRoundCount,
          });
          runRecord = await this.transitionState(
            runRecord.id,
            runRecord.status,
            AgentRunState.RUNNING,
            "Continuing model execution with tool results",
          );
        }
      }

      if (
        toolCallCount > 0 &&
        usedTools.length === 0 &&
        definition.buildInsufficientOutput
      ) {
        return this.persistInsufficientResult({
          definition,
          runRecord,
          usedTools,
          reason:
            "All required market data tools failed or returned unavailable data",
          durationMs: Date.now() - startTime,
          idempotencyFingerprint,
          toolCallCount,
          toolRoundCount,
        });
      }

      let fewShotContext = "";
      if (
        userId &&
        this.prisma &&
        (definition.type === AgentType.DECISION_SYNTHESIZER ||
          definition.type === AgentType.MARKET_ANALYST ||
          definition.type === AgentType.NEWS_ANALYST)
      ) {
        try {
          type FewShotPerformanceRecord = Prisma.PerformanceRecordGetPayload<{
            select: {
              symbol: true;
              decision: true;
              confidence: true;
              priceAtDecision: true;
              priceAfter: true;
              returnPct: true;
              outcome: true;
              horizon: true;
            };
          }>;

          const successes: FewShotPerformanceRecord[] =
            await this.prisma.performanceRecord.findMany({
              where: {
                userId,
                outcome: { in: ["CORRECT", "WRONG"] },
                horizon: { in: ["MID", "LONG"] },
                ...(typeof validatedInput.symbol === "string"
                  ? { symbol: validatedInput.symbol }
                  : {}),
              },
              orderBy: { evaluatedAt: "desc" },
              take: 6,
              select: {
                symbol: true,
                decision: true,
                confidence: true,
                priceAtDecision: true,
                priceAfter: true,
                returnPct: true,
                outcome: true,
                horizon: true,
              },
            });
          if (successes.length > 0) {
            fewShotContext = [
              "",
              "=== RECENT EVALUATED DECISIONS (BALANCED FEEDBACK) ===",
              ...successes.map(
                (success) =>
                  `- ${success.outcome} at ${success.horizon}: Symbol ${success.symbol}, decision ${success.decision}, confidence ${success.confidence}%, price ${success.priceAtDecision.toString()} -> ${success.priceAfter.toString()} (${success.returnPct.toFixed(2)}% net virtual return)`,
              ),
              "Use both wins and losses to calibrate reasoning. Do not copy their direction without current evidence.",
            ].join("\n");
          }
        } catch {
          // ignore
        }
      }

      let aiResponse;
      const deterministicOutput = definition.buildDeterministicOutput?.(
        toolData,
        usedTools,
      );
      if (deterministicOutput !== undefined) {
        aiResponse = {
          json: deterministicOutput,
          text: JSON.stringify(deterministicOutput),
          provider: "DETERMINISTIC",
          model: `${definition.type.toLowerCase()}-rules-v1`,
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            estimatedCost: 0,
          },
        };
      } else
        try {
          aiResponse = await this.aiOrchestratorService.execute({
            userId: userId || "00000000-0000-0000-0000-000000000000",
            sessionId: params.sessionId,
            provider: requestedProvider,
            model: definition.modelPolicy.preferredModel,
            systemPrompt: `${renderedPrompt.systemPrompt}${fewShotContext}\n\n${getAgentOutputContract(definition.type)}`,
            userPrompt: `${renderedPrompt.userPrompt}\n\nValidated tool results:\n${toolContext}`,
            temperature: definition.modelPolicy.defaultTemperature,
            maxTokens: definition.maxOutputTokens,
            responseFormat: definition.modelPolicy.requiresStructuredOutput
              ? "json"
              : "text",
          });
        } catch (error) {
          if (!definition.buildInsufficientOutput) throw error;
          const reason =
            error instanceof Error ? error.message : "AI provider unavailable";
          return this.persistInsufficientResult({
            definition,
            runRecord,
            usedTools,
            reason,
            durationMs: Date.now() - startTime,
            idempotencyFingerprint,
            toolCallCount,
            toolRoundCount,
          });
        }

      runRecord = await this.transitionState(
        runRecord.id,
        runRecord.status,
        AgentRunState.VALIDATING_OUTPUT,
        "Validating model response",
      );

      const modelOutput =
        definition.modelPolicy.requiresStructuredOutput && aiResponse.json
          ? aiResponse.json
          : aiResponse.text || {};
      const normalizedModelOutput: string | Record<string, unknown> =
        typeof modelOutput === "object" &&
        modelOutput !== null &&
        !Array.isArray(modelOutput)
          ? {
              ...modelOutput,
              ...(definition.includeUsedToolsInOutput ? { usedTools } : {}),
              generatedAt: new Date().toISOString(),
            }
          : (modelOutput as string);

      let validation = this.agentOutputValidatorService.validate({
        rawOutput: normalizedModelOutput,
        outputSchema: definition.outputSchema,
        agentType: definition.type,
        runId: runRecord.id,
      });

      if (
        validation.valid &&
        validation.validatedOutput &&
        definition.buildToolCalls
      ) {
        const validatedRecord = validation.validatedOutput as Record<
          string,
          unknown
        >;
        const normalizedOutput = {
          ...validatedRecord,
          dataQuality:
            usedTools.length < toolCallCount &&
            validatedRecord.dataQuality === "GOOD"
              ? "PARTIAL"
              : validatedRecord.dataQuality,
          ...(definition.includeUsedToolsInOutput ? { usedTools } : {}),
          generatedAt: new Date().toISOString(),
        };
        validation = this.agentOutputValidatorService.validate({
          rawOutput: normalizedOutput,
          outputSchema: definition.outputSchema,
          agentType: definition.type,
          runId: runRecord.id,
        });
      }

      const durationMs = Date.now() - startTime;

      if (validation.valid && validation.validatedOutput) {
        runRecord = await this.transitionState(
          runRecord.id,
          runRecord.status,
          AgentRunState.COMPLETED,
          "Output successfully validated",
        );

        await this.agentRunRepository.saveOutput({
          runId: runRecord.id,
          schemaVersion: 1,
          validatedOutput: validation.validatedOutput,
          rawOutput: validation.rawOutput,
        });

        runRecord = await this.agentRunRepository.updateRun(runRecord.id, {
          output: validation.validatedOutput,
          durationMs,
          inputTokens: aiResponse.usage.promptTokens,
          outputTokens: aiResponse.usage.completionTokens,
          estimatedCost: aiResponse.usage.estimatedCost,
          provider: aiResponse.provider,
          model: aiResponse.model,
          completedAt: new Date(),
        });

        await this.agentMemoryResolverService.persistOutput({
          userId,
          memoryPolicy: definition.memoryPolicy,
          agentType: definition.type,
          output: validation.validatedOutput as Record<string, unknown>,
          runId: runRecord.id,
        });

        if (userId) {
          await this.agentQuotaService.recordRun(userId);
        }
      } else {
        if (definition.buildInsufficientOutput) {
          return this.persistInsufficientResult({
            definition,
            runRecord,
            usedTools,
            reason: `Model output failed schema validation: ${(validation.errors || []).join("; ")}`,
            durationMs,
            idempotencyFingerprint,
            toolCallCount,
            toolRoundCount,
            alreadyValidating: true,
          });
        }
        runRecord = await this.transitionState(
          runRecord.id,
          runRecord.status,
          AgentRunState.FAILED,
          "Output validation failed",
        );
        runRecord = await this.agentRunRepository.updateRun(runRecord.id, {
          failureCode: AgentErrorCode.AGENT_OUTPUT_INVALID,
          safeFailureMessage: (validation.errors || []).join("; "),
          durationMs,
          completedAt: new Date(),
        });
      }

      await this.agentIdempotencyService.setResult(
        idempotencyFingerprint,
        runRecord.id,
        lockResult.lockToken,
      );
      return runRecord;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Run ${runRecord.id} failed: ${msg}`);

      try {
        await this.transitionState(
          runRecord.id,
          runRecord.status,
          AgentRunState.FAILED,
          `Execution error: ${msg}`,
        );
        await this.agentRunRepository.updateRun(runRecord.id, {
          failureCode: AgentErrorCode.AGENT_EXECUTION_FAILED,
          safeFailureMessage: msg,
          completedAt: new Date(),
        });
      } catch (subErr) {
        this.logger.error(
          `Failed to record failure status for run ${runRecord.id}`,
          subErr,
        );
      }

      throw err;
    } finally {
      if (globalLockToken)
        await this.agentConcurrencyService.releaseGlobal(globalLockToken);
      if (userLockToken && userId)
        await this.agentConcurrencyService.releaseUser(userId, userLockToken);
      if (typeLockToken)
        await this.agentConcurrencyService.releaseType(
          definition.type,
          typeLockToken,
        );
      await this.agentIdempotencyService.unlock(
        idempotencyFingerprint,
        lockResult.lockToken,
      );
    }
  }

  private async persistInsufficientResult(params: {
    definition: AgentDefinition;
    runRecord: AgentRun;
    usedTools: string[];
    reason: string;
    durationMs: number;
    idempotencyFingerprint: string;
    toolCallCount: number;
    toolRoundCount: number;
    alreadyValidating?: boolean;
  }): Promise<AgentRun> {
    let runRecord = params.runRecord;
    if (!params.alreadyValidating) {
      runRecord = await this.transitionState(
        runRecord.id,
        runRecord.status,
        AgentRunState.VALIDATING_OUTPUT,
        "Producing safe insufficient-data output",
      );
    }

    const output = params.definition.buildInsufficientOutput!(
      params.usedTools,
      params.reason,
    );
    const validation = params.definition.outputSchema.parse(
      output,
    ) as Prisma.InputJsonValue;

    runRecord = await this.transitionState(
      runRecord.id,
      runRecord.status,
      AgentRunState.PARTIALLY_COMPLETED,
      "Returned schema-valid insufficient-data output",
    );
    await this.agentRunRepository.saveOutput({
      runId: runRecord.id,
      schemaVersion: 1,
      validatedOutput: validation,
      rawOutput: JSON.stringify(validation),
    });
    runRecord = await this.agentRunRepository.updateRun(runRecord.id, {
      output: validation,
      durationMs: params.durationMs,
      toolCallCount: params.toolCallCount,
      toolRoundCount: params.toolRoundCount,
      safeFailureMessage: params.reason,
      completedAt: new Date(),
    });
    // Insufficient/partial outputs must be retried on the next scheduled run.
    // Caching them would pin a transient provider or market-data failure.
    return runRecord;
  }

  private async transitionState(
    runId: string,
    from: AgentRunState,
    to: AgentRunState,
    reason: string,
  ): Promise<AgentRun> {
    AgentStateMachine.transition(runId, from, to, reason, "AgentRunnerService");
    await this.agentRunRepository.addTransition({
      runId,
      fromState: from,
      toState: to,
      reason,
      actor: "AgentRunnerService",
    });
    return this.agentRunRepository.updateRun(runId, { status: to });
  }
}
