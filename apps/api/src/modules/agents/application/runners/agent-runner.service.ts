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

    const lockResult = await this.agentIdempotencyService.checkAndLock(inputHash);
    if (!lockResult.locked) {
      throw new AgentError(
        AgentErrorCode.AGENT_DUPLICATE_RUN,
        `A run with this input is already in progress (${lockResult.existingRunId || 'active'})`,
        false,
      );
    }

    let runRecord = await this.agentRunRepository.createRun({
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

      runRecord = await this.transitionState(runRecord.id, runRecord.status as AgentRunState, AgentRunState.PREPARING_CONTEXT, 'Context preparation started');

      const { snapshotId, contextString } = await this.agentContextBuilderService.buildAndPersistSnapshot({
        agentDefinition: definition,
        userId,
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

      runRecord = await this.transitionState(runRecord.id, runRecord.status as AgentRunState, AgentRunState.READY, 'Context and prompt prepared');

      const { providerSchemas, resolvedToolNames } = this.agentToolResolverService.resolveTools({
        allowedToolNames: definition.allowedToolNames,
        requiredCapabilities: definition.requiredCapabilities,
        provider: definition.modelPolicy.preferredProvider || 'OPENAI',
      });

      runRecord = await this.transitionState(runRecord.id, runRecord.status as AgentRunState, AgentRunState.RUNNING, 'AI model execution started');

      const startTime = Date.now();
      const aiResponse = await this.aiOrchestratorService.execute({
        userId: userId || '00000000-0000-0000-0000-000000000000',
        sessionId: params.sessionId,
        provider: (definition.modelPolicy.preferredProvider as any) || 'OPENAI',
        model: definition.modelPolicy.preferredModel,
        systemPrompt: renderedPrompt.systemPrompt,
        userPrompt: renderedPrompt.userPrompt,
        temperature: definition.modelPolicy.defaultTemperature,
        maxTokens: definition.maxOutputTokens,
      });

      runRecord = await this.transitionState(runRecord.id, runRecord.status as AgentRunState, AgentRunState.VALIDATING_OUTPUT, 'Validating model response');

      const validation = this.agentOutputValidatorService.validate({
        rawOutput: aiResponse.text || JSON.stringify(aiResponse.json || {}),
        outputSchema: definition.outputSchema,
        agentType: definition.type,
        runId: runRecord.id,
      });

      const durationMs = Date.now() - startTime;

      if (validation.valid && validation.validatedOutput) {
        runRecord = await this.transitionState(runRecord.id, runRecord.status as AgentRunState, AgentRunState.COMPLETED, 'Output successfully validated');

        await this.agentRunRepository.saveOutput({
          runId: runRecord.id,
          schemaVersion: 1,
          validatedOutput: validation.validatedOutput as Prisma.InputJsonValue,
          rawOutput: validation.rawOutput,
        });

        runRecord = await this.agentRunRepository.updateRun(runRecord.id, {
          output: validation.validatedOutput as Prisma.InputJsonValue,
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
        runRecord = await this.transitionState(runRecord.id, runRecord.status as AgentRunState, AgentRunState.FAILED, 'Output validation failed');
        runRecord = await this.agentRunRepository.updateRun(runRecord.id, {
          failureCode: AgentErrorCode.AGENT_OUTPUT_INVALID,
          safeFailureMessage: (validation.errors || []).join('; '),
          durationMs,
          completedAt: new Date(),
        });
      }

      await this.agentIdempotencyService.setResult(inputHash, runRecord.id);
      return runRecord;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Run ${runRecord.id} failed: ${msg}`);

      try {
        await this.transitionState(runRecord.id, runRecord.status as AgentRunState, AgentRunState.FAILED, `Execution error: ${msg}`);
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
      await this.agentIdempotencyService.unlock(inputHash);
    }
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
      fromState: from as any,
      toState: to as any,
      reason,
      actor: 'AgentRunnerService',
    });
    return this.agentRunRepository.updateRun(runId, { status: to as any });
  }
}
