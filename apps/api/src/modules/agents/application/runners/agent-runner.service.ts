import { Injectable, Logger } from '@nestjs/common';
import { AIOrchestratorService } from '../../../ai/application/ai-orchestrator.service';
import { AgentRunRepository } from '../../infrastructure/persistence/agent-run.repository';
import { AgentContextBuilderService } from '../context/agent-context-builder.service';
import { AgentPromptResolverService } from '../services/agent-prompt-resolver.service';
import { AgentToolResolverService } from '../services/agent-tool-resolver.service';
import { AgentMemoryResolverService } from '../services/agent-memory-resolver.service';
import { AgentOutputValidatorService } from '../services/agent-output-validator.service';
import { AgentCancellationService } from '../../infrastructure/redis/agent-cancellation.service';
import { AgentConcurrencyService } from '../../infrastructure/redis/agent-concurrency.service';
import { AgentIdempotencyService } from '../../infrastructure/redis/agent-idempotency.service';
import { AgentQuotaService } from '../../infrastructure/redis/agent-quota.service';
import { ToolLoopRunnerService } from '../../../ai-tools/application/tool-loop-runner.service';
import type { AgentDefinition } from '../../domain/models/agent-definition.model';
import { AgentInvocationSource, AgentRunState } from '../../domain/enums';
import { AgentStateMachine } from '../../domain/state-machine/agent-state-machine';
import { AgentError, AgentErrorCode } from '../../domain/errors/agent-errors';
import { AgentRun, Prisma } from '@prisma/client';
import type { AIProviderType, ToolCapability } from '@platform/shared';
import { createHash, randomUUID } from 'node:crypto';

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
    const inputHash = createHash('sha256').update(inputString).digest('hex');
    const idempotencyFingerprint = createHash('sha256')
      .update(
        `${userId ?? 'public'}:${definition.type}:${definition.version}:${inputHash}`,
      )
      .digest('hex');

    const lockResult = await this.agentIdempotencyService.checkAndLock(
      idempotencyFingerprint,
    );
    if (!lockResult.locked) {
      if (
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
        `A run with this input is already in progress (${lockResult.existingRunId || 'active'})`,
        false,
      );
    }

    let runRecord: AgentRun;
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

    let globalLock = false;
    let userLock = false;
    let typeLock = false;

    try {
      const gRes = await this.agentConcurrencyService.acquireGlobal();
      if (!gRes.acquired) {
        throw new AgentError(AgentErrorCode.AGENT_CONCURRENCY_EXCEEDED, 'Global concurrency limit reached', false);
      }
      globalLock = true;

      if (userId) {
        const uRes = await this.agentConcurrencyService.acquireUser(userId);
        if (!uRes.acquired) {
          throw new AgentError(AgentErrorCode.AGENT_CONCURRENCY_EXCEEDED, 'User concurrency limit reached', false);
        }
        userLock = true;
      }

      const tRes = await this.agentConcurrencyService.acquireType(definition.type);
      if (!tRes.acquired) {
        throw new AgentError(AgentErrorCode.AGENT_CONCURRENCY_EXCEEDED, 'Agent type concurrency limit reached', false);
      }
      typeLock = true;

      runRecord = await this.transitionState(runRecord.id, runRecord.status, AgentRunState.PREPARING_CONTEXT, 'Context preparation started');

      const validatedInput = inputParseResult.data as Record<string, unknown>;
      const { snapshotId, contextString } = await this.agentContextBuilderService.buildAndPersistSnapshot({
        agentDefinition: definition,
        userId,
        symbol: typeof validatedInput.symbol === 'string' ? validatedInput.symbol : undefined,
        timeframe: typeof validatedInput.interval === 'string' ? validatedInput.interval : undefined,
        provider: typeof validatedInput.provider === 'string' ? validatedInput.provider : undefined,
      });

      runRecord = await this.agentRunRepository.updateRun(runRecord.id, { contextSnapshotId: snapshotId });

      const { renderedPrompt } = this.agentPromptResolverService.resolve({
        promptId: definition.promptId,
        promptVersion: definition.promptVersion,
        variables: input,
        contextString,
      });

      await this.agentMemoryResolverService.loadMemory({
        userId,
        memoryPolicy: definition.memoryPolicy,
        agentType: definition.type,
      });

      runRecord = await this.transitionState(runRecord.id, runRecord.status, AgentRunState.READY, 'Context and prompt prepared');

      const resolvedTools = this.agentToolResolverService.resolveTools({
        allowedToolNames: definition.allowedToolNames,
        requiredCapabilities: definition.requiredCapabilities,
        provider: (definition.modelPolicy.preferredProvider as AIProviderType | undefined) || 'OPENAI',
      });

      runRecord = await this.transitionState(runRecord.id, runRecord.status, AgentRunState.RUNNING, 'AI model execution started');

      const startTime = Date.now();
      let toolCallCount = 0;
      let toolRoundCount = 0;
      let usedTools: string[] = [];
      let toolContext = contextString;

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
            'Waiting for allowlisted market data tools',
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
              source: 'INTERNAL_AGENT',
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
            .filter(({ result }) => result.status === 'SUCCESS' || result.status === 'PARTIAL')
            .map(({ toolName }) => toolName);
          toolContext = JSON.stringify(
            {
              contextPolicy: {
                candleMaxAgeSeconds:
                  definition.contextPolicy.maximumAgeSecondsBySection.MARKET_CANDLES,
                tickerMaxAgeSeconds:
                  definition.contextPolicy.maximumAgeSecondsBySection.MARKET_TICKER,
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
            'Processing sanitized tool results',
          );
          runRecord = await this.agentRunRepository.updateRun(runRecord.id, {
            toolCallCount,
            toolRoundCount,
          });
          runRecord = await this.transitionState(
            runRecord.id,
            runRecord.status,
            AgentRunState.RUNNING,
            'Continuing model execution with tool results',
          );
        }
      }

      if (toolCallCount > 0 && usedTools.length === 0 && definition.buildInsufficientOutput) {
        return this.persistInsufficientResult({
          definition,
          runRecord,
          usedTools,
          reason: 'All required market data tools failed or returned unavailable data',
          durationMs: Date.now() - startTime,
          idempotencyFingerprint,
          toolCallCount,
          toolRoundCount,
        });
      }

      let aiResponse;
      try {
        aiResponse = await this.aiOrchestratorService.execute({
          userId: userId || '00000000-0000-0000-0000-000000000000',
          sessionId: params.sessionId,
          provider: (definition.modelPolicy.preferredProvider as AIProviderType | undefined) || 'OPENAI',
          model: definition.modelPolicy.preferredModel,
          systemPrompt: renderedPrompt.systemPrompt,
          userPrompt: `${renderedPrompt.userPrompt}\n\nValidated tool results:\n${toolContext}`,
          temperature: definition.modelPolicy.defaultTemperature,
          maxTokens: definition.maxOutputTokens,
          responseFormat: definition.modelPolicy.requiresStructuredOutput ? 'json' : 'text',
        });
      } catch (error) {
        if (!definition.buildInsufficientOutput) throw error;
        const reason = error instanceof Error ? error.message : 'AI provider unavailable';
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

      runRecord = await this.transitionState(runRecord.id, runRecord.status, AgentRunState.VALIDATING_OUTPUT, 'Validating model response');

      let validation = this.agentOutputValidatorService.validate({
        rawOutput:
          definition.modelPolicy.requiresStructuredOutput && aiResponse.json
            ? aiResponse.json
            : aiResponse.text || {},
        outputSchema: definition.outputSchema,
        agentType: definition.type,
        runId: runRecord.id,
      });

      if (
        validation.valid &&
        validation.validatedOutput &&
        definition.buildToolCalls
      ) {
        const validatedRecord = validation.validatedOutput as Record<string, unknown>;
        const normalizedOutput = {
          ...validatedRecord,
          dataQuality:
            usedTools.length < toolCallCount && validatedRecord.dataQuality === 'GOOD'
              ? 'PARTIAL'
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
        runRecord = await this.transitionState(runRecord.id, runRecord.status, AgentRunState.COMPLETED, 'Output successfully validated');

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
            reason: `Model output failed schema validation: ${(validation.errors || []).join('; ')}`,
            durationMs,
            idempotencyFingerprint,
            toolCallCount,
            toolRoundCount,
            alreadyValidating: true,
          });
        }
        runRecord = await this.transitionState(runRecord.id, runRecord.status, AgentRunState.FAILED, 'Output validation failed');
        runRecord = await this.agentRunRepository.updateRun(runRecord.id, {
          failureCode: AgentErrorCode.AGENT_OUTPUT_INVALID,
          safeFailureMessage: (validation.errors || []).join('; '),
          durationMs,
          completedAt: new Date(),
        });
      }

      await this.agentIdempotencyService.setResult(
        idempotencyFingerprint,
        runRecord.id,
      );
      return runRecord;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Run ${runRecord.id} failed: ${msg}`);

      try {
        await this.transitionState(runRecord.id, runRecord.status, AgentRunState.FAILED, `Execution error: ${msg}`);
        await this.agentRunRepository.updateRun(runRecord.id, {
          failureCode: AgentErrorCode.AGENT_EXECUTION_FAILED,
          safeFailureMessage: msg,
          completedAt: new Date(),
        });
      } catch (subErr) {
        this.logger.error(`Failed to record failure status for run ${runRecord.id}`, subErr);
      }

      throw err;
    } finally {
      if (globalLock) await this.agentConcurrencyService.releaseGlobal();
      if (userLock && userId) await this.agentConcurrencyService.releaseUser(userId);
      if (typeLock) await this.agentConcurrencyService.releaseType(definition.type);
      await this.agentIdempotencyService.unlock(idempotencyFingerprint);
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
        'Producing safe insufficient-data output',
      );
    }

    const output = params.definition.buildInsufficientOutput!(
      params.usedTools,
      params.reason,
    );
    const validation = params.definition.outputSchema.parse(output) as Prisma.InputJsonValue;

    runRecord = await this.transitionState(
      runRecord.id,
      runRecord.status,
      AgentRunState.PARTIALLY_COMPLETED,
      'Returned schema-valid insufficient-data output',
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
    await this.agentIdempotencyService.setResult(
      params.idempotencyFingerprint,
      runRecord.id,
    );
    return runRecord;
  }

  private async transitionState(
    runId: string,
    from: AgentRunState,
    to: AgentRunState,
    reason: string,
  ): Promise<AgentRun> {
    AgentStateMachine.transition(runId, from, to, reason, 'AgentRunnerService');
    await this.agentRunRepository.addTransition({
      runId,
      fromState: from,
      toState: to,
      reason,
      actor: 'AgentRunnerService',
    });
    return this.agentRunRepository.updateRun(runId, { status: to });
  }
}
