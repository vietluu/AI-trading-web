import { Injectable, Logger } from '@nestjs/common';
import { AgentType, AgentInvocationSource, AgentStatus } from '../../domain/enums';
import { AgentPolicyDecision } from '../../domain/models/agent-policies.model';
import { AgentRegistryService } from '../../infrastructure/registry/agent-registry.service';
import { BudgetManagerService } from '../../../ai/infrastructure/budget/budget-manager.service';
import { AgentQuotaService } from '../../infrastructure/redis/agent-quota.service';
import { AgentConcurrencyService } from '../../infrastructure/redis/agent-concurrency.service';

@Injectable()
export class AgentPolicyEngine {
  private readonly logger = new Logger(AgentPolicyEngine.name);

  constructor(
    private readonly agentRegistryService: AgentRegistryService,
    private readonly budgetManagerService: BudgetManagerService,
    private readonly agentQuotaService: AgentQuotaService,
    private readonly agentConcurrencyService: AgentConcurrencyService,
  ) {}

  public async evaluate(
    agentType: AgentType,
    version: number | undefined,
    options: { userId?: string; invocationSource: AgentInvocationSource; inputSizeBytes?: number },
  ): Promise<AgentPolicyDecision> {
    const reasons: { code: string; message: string; severity: 'ERROR' | 'WARNING' | 'INFO' }[] = [];

    const agent = this.agentRegistryService.resolve(agentType, version);
    if (!agent) {
      return {
        status: 'DENY',
        reasons: [{ code: 'AGENT_NOT_FOUND', message: `Agent ${agentType} not found`, severity: 'ERROR' }],
        policyVersion: 1,
        evaluatedAt: new Date(),
      };
    }

    if (agent.status !== AgentStatus.ACTIVE && agent.status !== AgentStatus.EXPERIMENTAL) {
      reasons.push({
        code: 'AGENT_INACTIVE',
        message: `Agent status is ${agent.status}, requires ACTIVE or EXPERIMENTAL`,
        severity: 'ERROR',
      });
    }

    if (agent.requiresUserContext && !options.userId && !agent.allowsPublicSystemRun) {
      reasons.push({
        code: 'USER_CONTEXT_REQUIRED',
        message: 'User context is required for this agent execution',
        severity: 'ERROR',
      });
    }

    if (options.userId) {
      const budgetResult = await this.budgetManagerService.checkBudget(options.userId);
      if (!budgetResult.allowed) {
        reasons.push({
          code: 'BUDGET_EXCEEDED',
          message: `User budget check failed: ${budgetResult.reason}`,
          severity: 'ERROR',
        });
      }

      const quotaResult = await this.agentQuotaService.checkQuota(options.userId);
      if (!quotaResult.allowed) {
        reasons.push({
          code: 'QUOTA_EXCEEDED',
          message: `User quota check failed: ${quotaResult.reason}`,
          severity: 'ERROR',
        });
      }
    }

    if (reasons.length > 0) {
      return {
        status: 'DENY',
        reasons,
        policyVersion: 1,
        evaluatedAt: new Date(),
      };
    }

    return {
      status: 'ALLOW',
      reasons: [],
      policyVersion: 1,
      evaluatedAt: new Date(),
    };
  }
}
