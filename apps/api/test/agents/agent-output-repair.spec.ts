import { describe, expect, it } from 'vitest';
import { MarketAgentOutputSchema, OnChainAgentOutputSchema } from '@platform/shared';
import { AgentOutputValidatorService } from '../../src/modules/agents/application/services/agent-output-validator.service';
import { AgentType } from '../../src/modules/agents/domain/enums';

describe('AgentOutputValidatorService structural repair', () => {
  it('repairs omitted non-substantive Market sections before strict validation', () => {
    const validation = new AgentOutputValidatorService().validate({
      rawOutput: {
        summary: 'Market is ranging.',
        trend: { direction: 'SIDEWAYS', strength: 'WEAK' },
        volatility: { level: 'LOW' },
        dataQuality: 'PARTIAL',
        usedTools: ['market.candles.list'],
        generatedAt: new Date().toISOString(),
      },
      outputSchema: MarketAgentOutputSchema,
      agentType: AgentType.MARKET_ANALYST,
      runId: 'repair-test',
    });

    expect(validation.valid).toBe(true);
    expect(validation.validatedOutput).toEqual(expect.objectContaining({
      liquidity: {}, derivatives: {}, anomalies: [],
    }));
  });

  it('does not fabricate substantive fields such as trend', () => {
    const validation = new AgentOutputValidatorService().validate({
      rawOutput: {
        summary: 'Incomplete output.',
        volatility: { level: 'LOW' },
        dataQuality: 'PARTIAL',
        usedTools: [],
        generatedAt: new Date().toISOString(),
      },
      outputSchema: MarketAgentOutputSchema,
      agentType: AgentType.MARKET_ANALYST,
      runId: 'repair-test-invalid',
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('trend'),
    ]));
  });

  it('repairs omitted empty On-chain collections without fabricating metrics', () => {
    const validation = new AgentOutputValidatorService().validate({
      rawOutput: {
        summary: 'Coin Metrics has no verified coverage for ALGO.',
        activity: 'NORMAL',
        dataQuality: 'INSUFFICIENT',
        generatedAt: new Date().toISOString(),
      },
      outputSchema: OnChainAgentOutputSchema,
      agentType: AgentType.ON_CHAIN_ANALYST,
      runId: 'onchain-repair-test',
    });

    expect(validation.valid).toBe(true);
    expect(validation.validatedOutput).toEqual(expect.objectContaining({
      flows: {}, signals: [],
    }));
  });

  it('does not replace malformed On-chain flow data', () => {
    const validation = new AgentOutputValidatorService().validate({
      rawOutput: {
        summary: 'Malformed provider output.',
        activity: 'NORMAL',
        flows: 'unverified',
        signals: [],
        dataQuality: 'INSUFFICIENT',
        generatedAt: new Date().toISOString(),
      },
      outputSchema: OnChainAgentOutputSchema,
      agentType: AgentType.ON_CHAIN_ANALYST,
      runId: 'onchain-invalid-flow-test',
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('flows'),
    ]));
  });
});
