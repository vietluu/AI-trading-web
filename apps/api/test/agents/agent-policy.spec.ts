import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentPolicyEngine } from '../../src/modules/agents/application/policies/agent-policy.engine';
import { AgentRegistryService } from '../../src/modules/agents/infrastructure/registry/agent-registry.service';
import { SYSTEM_DIAGNOSTIC_DEFINITION } from '../../src/modules/agents/domain/definitions/system-diagnostic.definition';
import { AgentType, AgentInvocationSource } from '../../src/modules/agents/domain/enums';

describe('AgentPolicyEngine', () => {
  let policyEngine: AgentPolicyEngine;
  let registry: AgentRegistryService;
  let mockBudgetManager: any;
  let mockQuotaService: any;
  let mockConcurrencyService: any;

  beforeEach(() => {
    registry = new AgentRegistryService();
    registry.register(SYSTEM_DIAGNOSTIC_DEFINITION);

    mockBudgetManager = {
      checkBudget: vi.fn().mockResolvedValue({ allowed: true }),
    };

    mockQuotaService = {
      checkQuota: vi.fn().mockResolvedValue({ allowed: true }),
    };

    mockConcurrencyService = {};

    policyEngine = new AgentPolicyEngine(
      registry,
      mockBudgetManager,
      mockQuotaService,
      mockConcurrencyService,
    );
  });

  it('should allow execution for registered active agent', async () => {
    const decision = await policyEngine.evaluate(AgentType.SYSTEM_DIAGNOSTIC, 1, {
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
    });

    expect(decision.status).toBe('ALLOW');
    expect(decision.reasons).toHaveLength(0);
  });

  it('should deny execution if agent type does not exist', async () => {
    const decision = await policyEngine.evaluate('UNKNOWN_AGENT' as any, 1, {
      invocationSource: AgentInvocationSource.USER_MANUAL,
    });

    expect(decision.status).toBe('DENY');
    expect(decision.reasons[0].code).toBe('AGENT_NOT_FOUND');
  });

  it('should deny execution if user budget check fails', async () => {
    mockBudgetManager.checkBudget.mockResolvedValueOnce({
      allowed: false,
      reason: 'Daily limit exceeded',
    });

    const decision = await policyEngine.evaluate(AgentType.SYSTEM_DIAGNOSTIC, 1, {
      userId: 'user-123',
      invocationSource: AgentInvocationSource.USER_MANUAL,
    });

    expect(decision.status).toBe('DENY');
    expect(decision.reasons[0].code).toBe('BUDGET_EXCEEDED');
  });
});
