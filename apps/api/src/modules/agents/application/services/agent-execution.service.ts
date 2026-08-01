import { Injectable, Logger } from '@nestjs/common';
import { AgentRegistryService } from '../../infrastructure/registry/agent-registry.service';
import { AgentPolicyEngine } from '../policies/agent-policy.engine';
import { AgentRunnerService } from '../runners/agent-runner.service';
import { AgentRunProducer } from '../../infrastructure/queues/agent-run.producer';
import { AgentType, AgentInvocationSource } from '../../domain/enums';
import { AgentError, AgentErrorCode } from '../../domain/errors/agent-errors';
import { AgentRun } from '@prisma/client';
import { randomUUID } from 'node:crypto';

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
}

@Injectable()
export class AgentExecutionService {
  private readonly logger = new Logger(AgentExecutionService.name);

  constructor(
    private readonly agentRegistryService: AgentRegistryService,
    private readonly agentPolicyEngine: AgentPolicyEngine,
    private readonly agentRunnerService: AgentRunnerService,
    private readonly agentRunProducer: AgentRunProducer,
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
    const runId = randomUUID();

    await this.agentRunProducer.enqueue({
      agentRunId: runId,
      userId: options.userId,
      agentType: options.agentType,
      agentVersion: definition.version,
      inputReference: JSON.stringify(options.input),
      correlationId,
    });

    this.logger.log({
      event: 'agent_run_enqueued',
      runId,
      agentType: options.agentType,
      userId: options.userId,
      correlationId,
    });

    return { runId, status: 'QUEUED' };
  }
}
