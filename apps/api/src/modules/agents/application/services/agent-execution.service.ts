import { Injectable, Logger } from '@nestjs/common';
import { AgentRegistryService } from '../../infrastructure/registry/agent-registry.service';
import { AgentPolicyEngine } from '../policies/agent-policy.engine';
import { AgentRunnerService } from '../runners/agent-runner.service';
import { AgentRunProducer } from '../../infrastructure/queues/agent-run.producer';
import { AgentType, AgentInvocationSource, AgentRunState } from '../../domain/enums';
import { AgentError, AgentErrorCode } from '../../domain/errors/agent-errors';
import { AgentRun } from '@prisma/client';
import { AgentRunRepository } from '../../infrastructure/persistence/agent-run.repository';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';

export interface ExecuteAgentOptions {
  agentType: AgentType;
  version?: number;
  userId?: string;
  sessionId?: string;
  input: Record<string, unknown>;
  invocationSource: AgentInvocationSource;
  correlationId?: string;
  parentRunId?: string;
  replayOfRunId?: string;
  existingRunId?: string;
}

@Injectable()
export class AgentExecutionService {
  private readonly logger = new Logger(AgentExecutionService.name);

  constructor(
    private readonly agentRegistryService: AgentRegistryService,
    private readonly agentPolicyEngine: AgentPolicyEngine,
    private readonly agentRunnerService: AgentRunnerService,
    private readonly agentRunProducer: AgentRunProducer,
    private readonly agentRunRepository: AgentRunRepository,
  ) {}

  public async executeSync(options: ExecuteAgentOptions): Promise<AgentRun> {
    const policyDecision = await this.agentPolicyEngine.evaluate(options.agentType, options.version, {
      userId: options.userId,
      invocationSource: options.invocationSource,
    });

    if (policyDecision.status === 'DENY') {
      const reasonMsgs = policyDecision.reasons.map((r) => r.message).join('; ');
      throw new AgentError(AgentErrorCode.AGENT_POLICY_DENIED, `Execution denied: ${reasonMsgs}`, false);
    }

    const definition = this.agentRegistryService.resolve(options.agentType, options.version);
    if (!definition) {
      throw new AgentError(
        AgentErrorCode.AGENT_NOT_FOUND,
        `Agent definition for ${options.agentType} version ${options.version || 'latest'} not found`,
        false,
      );
    }

    return this.agentRunnerService.run({
      definition,
      userId: options.userId,
      sessionId: options.sessionId,
      input: options.input,
      invocationSource: options.invocationSource,
      correlationId: options.correlationId || randomUUID(),
      parentRunId: options.parentRunId,
      replayOfRunId: options.replayOfRunId,
      existingRunId: options.existingRunId,
    });
  }

  public async executeAsync(options: ExecuteAgentOptions): Promise<{ runId: string; status: string }> {
    const policyDecision = await this.agentPolicyEngine.evaluate(options.agentType, options.version, {
      userId: options.userId,
      invocationSource: options.invocationSource,
    });

    if (policyDecision.status === 'DENY') {
      const reasonMsgs = policyDecision.reasons.map((r) => r.message).join('; ');
      throw new AgentError(AgentErrorCode.AGENT_POLICY_DENIED, `Execution denied: ${reasonMsgs}`, false);
    }

    const definition = this.agentRegistryService.resolve(options.agentType, options.version);
    if (!definition) {
      throw new AgentError(
        AgentErrorCode.AGENT_NOT_FOUND,
        `Agent definition for ${options.agentType} version ${options.version || 'latest'} not found`,
        false,
      );
    }

    const correlationId = options.correlationId || randomUUID();
    const inputHash = createHash('sha256')
      .update(JSON.stringify(options.input))
      .digest('hex');
    let run = await this.agentRunRepository.createRun({
      userId: options.userId,
      agentType: options.agentType,
      agentVersion: definition.version,
      invocationSource: options.invocationSource,
      inputHash,
      sanitizedInput: options.input as Prisma.InputJsonValue,
      promptId: definition.promptId,
      promptVersion: definition.promptVersion,
      traceId: randomUUID(),
      correlationId,
      parentRunId: options.parentRunId,
      replayOfRunId: options.replayOfRunId,
    });
    await this.agentRunRepository.addTransition({
      runId: run.id,
      fromState: AgentRunState.CREATED,
      toState: AgentRunState.QUEUED,
      reason: 'Agent run enqueued for asynchronous execution',
      actor: 'AgentExecutionService',
      correlationId,
    });
    run = await this.agentRunRepository.updateRun(run.id, {
      status: AgentRunState.QUEUED,
    });

    await this.agentRunProducer.enqueue({
      agentRunId: run.id,
      userId: options.userId,
      agentType: options.agentType,
      agentVersion: definition.version,
      inputReference: JSON.stringify(options.input),
      correlationId,
      invocationSource: options.invocationSource,
    });

    this.logger.log({
      event: 'agent_run_enqueued',
      runId: run.id,
      agentType: options.agentType,
      userId: options.userId,
      correlationId,
    });

    return { runId: run.id, status: 'QUEUED' };
  }
}
