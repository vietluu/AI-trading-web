import { TradeResearcherService, type TradeResearcherContext } from '../../src/modules/agents/application/services/trade-researcher.service';
import { type DecisionOutput, type TradeThesis } from '@platform/shared';
import { describe, expect, it, beforeEach, afterEach, vi, type Mock } from 'vitest';

import { createBaseSnapshot, cutoff } from '../helpers/thesis-fixture';
import type { AIOrchestratorService } from '../../src/modules/ai/application/ai-orchestrator.service';
import type { DecisionService } from '../../src/modules/agents/application/services/decision.service';
import type { PrismaService } from '../../src/database/prisma.service';

describe('TradeResearcherService', () => {
  let service: TradeResearcherService;
  let aiOrchestratorService: { execute: Mock<AIOrchestratorService['execute']> };
  let decisionService: { run: Mock<() => Promise<Partial<DecisionOutput>>> };
  let prismaService: { agentRun: { create: Mock<(args: unknown) => Promise<unknown>> }; agentContextSnapshot: { create: Mock } };

  const mockSnapshot = createBaseSnapshot();

  const mockContext: TradeResearcherContext = {
    userId: '123',
    provider: 'OPENAI',
    model: 'gpt-4o',
    configHash: 'hash',
    parentSnapshotId: 'snapshot-id',
    promptVersion: 1,
  };

  const createBaseThesis = (direction: 'LONG' | 'SHORT' | 'WAIT'): TradeThesis => ({
    thesisVersion: 1,
    decisionSource: 'AI',
    state: 'PROBE_READY',
    direction,
    regime: 'TRENDING',
    transitionProbability: 0.1,
    setup: direction === 'WAIT' ? 'NO_TRADE' : 'TREND_PULLBACK',
    entryZone: direction === 'WAIT' ? null : { lower: 108000, upper: 108500 },
    trigger: [{ type: 'PRICE_ABOVE', price: 108100, description: 'Reclaim' }],
    invalidation: direction === 'WAIT' ? null : { 
      price: direction === 'SHORT' ? 109000 : 107400,
      reason: 'x' 
    },
    stopLoss: direction === 'WAIT' ? null : (direction === 'SHORT' ? 109000 : 107400),
    targets: direction === 'WAIT' ? [] : [
      { price: direction === 'SHORT' ? 104000 : 112000, fraction: 1 }
    ],
    expectedNetR: direction === 'WAIT' ? null : 2,
    maximumChaseDistanceAtr: 1,
    confidence: 80,
    evidenceFor: mockSnapshot.structure.coverage === 'AVAILABLE' ? mockSnapshot.structure.evidence : [],
    evidenceAgainst: [],
    missingEvidence: [],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });

  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(cutoff));
    aiOrchestratorService = {
      execute: vi.fn<AIOrchestratorService['execute']>(),
    };

    decisionService = {
      run: vi.fn<() => Promise<Partial<DecisionOutput>>>().mockResolvedValue({
        decision: 'WAIT',
        confidence: 50,
        regime: { type: 'RANGING' },
        expectedValue: 0,
        profitFactorEstimate: 1,
        expectedWinProbability: 0.5,
        expectedReward: 1,
        expectedLoss: 1,
        executionCost: 0.1,
      }),
    };
    
    prismaService = {
      agentContextSnapshot: { create: vi.fn().mockResolvedValue({ id: 'context-snapshot-id' }) },
      agentRun: {
        create: vi.fn<(args: unknown) => Promise<unknown>>().mockResolvedValue({ id: 'research-run-id' }),
      }
    };

    service = new TradeResearcherService(
      aiOrchestratorService as unknown as AIOrchestratorService,
      decisionService as unknown as DecisionService,
      prismaService as unknown as PrismaService
    );
  });

  it('should return valid LONG/SHORT/WAIT alternatives when AI succeeds and persist metadata', async () => {
    const longThesis = createBaseThesis('LONG');
    const shortThesis = createBaseThesis('SHORT');
    const waitThesis = createBaseThesis('WAIT');

    aiOrchestratorService.execute.mockResolvedValue({
      json: {
        preferred: longThesis,
        alternatives: [shortThesis, waitThesis],
      },
      text: '',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, estimatedCost: 0 },
      latencyMs: 100,
      provider: 'OPENAI',
      model: 'gpt-4o',
    });

    const result = await service.research(mockSnapshot, mockContext);

    expect(result.preferred.direction).toBe('LONG');
    expect(result.alternatives).toHaveLength(2);
    expect(result.alternatives[0]?.direction).toBe('SHORT');
    expect(result.alternatives[1]?.direction).toBe('WAIT');
    expect(result.preferred.decisionSource).toBe('AI');
    expect(prismaService.agentRun.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        inputHash: 'hash',
        contextSnapshotId: 'context-snapshot-id',
        promptVersion: 1,
        provider: 'OPENAI',
        model: 'gpt-4o',
      }
    });
  });

  it('should fall back to rules and label AI_WITH_RULES_FALLBACK on AI timeout', async () => {
    aiOrchestratorService.execute.mockRejectedValue(new Error('timeout'));
    
    decisionService.run.mockResolvedValue({
      decision: 'SHORT',
      confidence: 75,
      regime: { type: 'TRENDING' },
      expectedValue: 1,
      profitFactorEstimate: 1.5,
      expectedWinProbability: 0.6,
      expectedReward: 2,
      expectedLoss: 1,
      executionCost: 0.1,
    });

    const result = await service.research(mockSnapshot, mockContext);

    expect(result.preferred.direction).toBe('SHORT');
    expect(result.preferred.decisionSource).toBe('AI_WITH_RULES_FALLBACK');
    expect(result.preferred.confidence).toBe(75);
    expect(result.alternatives).toHaveLength(0);
    // Should persist failure
    expect(prismaService.agentRun.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        status: 'FAILED',
      }
    });
  });

  it('should reject invalid evidence-ref and fallback to rules', async () => {
    const invalidThesis = createBaseThesis('LONG');
    invalidThesis.evidenceFor = [
      { snapshotField: 'does.not.exist', source: 'x', sourceTimestamp: new Date().toISOString(), calculationVersion: 1 }
    ];

    aiOrchestratorService.execute.mockResolvedValue({
      json: {
        preferred: invalidThesis,
        alternatives: [],
      },
      text: '',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, estimatedCost: 0 },
      latencyMs: 100,
      provider: 'OPENAI',
      model: 'gpt-4o',
    });
    
    decisionService.run.mockResolvedValue({
      decision: 'WAIT',
      confidence: 50,
      regime: { type: 'RANGING' },
      expectedValue: 0,
      profitFactorEstimate: 1,
      expectedWinProbability: 0.5,
      expectedReward: 1,
      expectedLoss: 1,
      executionCost: 0.1,
    });

    const result = await service.research(mockSnapshot, mockContext);

    expect(result.preferred.decisionSource).toBe('AI_WITH_RULES_FALLBACK');
    expect(result.preferred.direction).toBe('WAIT');
  });

  it('should fallback to rules when parsing AI output fails', async () => {
    aiOrchestratorService.execute.mockResolvedValue({
      json: {
        preferred: { direction: 'LONG' }, // missing required fields
        alternatives: [],
      },
      text: '',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, estimatedCost: 0 },
      latencyMs: 100,
      provider: 'OPENAI',
      model: 'gpt-4o',
    });

    decisionService.run.mockResolvedValue({
      decision: 'LONG',
      confidence: 90,
      regime: { type: 'TRENDING' },
      expectedValue: 1.5,
      profitFactorEstimate: 2.0,
      expectedWinProbability: 0.65,
      expectedReward: 3,
      expectedLoss: 1,
      executionCost: 0.1,
    });

    const result = await service.research(mockSnapshot, mockContext);

    expect(result.preferred.decisionSource).toBe('AI_WITH_RULES_FALLBACK');
    expect(result.preferred.direction).toBe('LONG');
    expect(result.preferred.confidence).toBe(90);
  });

  it('should fallback to rules when multiple theses have the same direction', async () => {
    const longThesis1 = createBaseThesis('LONG');
    const longThesis2 = createBaseThesis('LONG'); // duplicate direction

    aiOrchestratorService.execute.mockResolvedValue({
      json: {
        preferred: longThesis1,
        alternatives: [longThesis2],
      },
      text: '',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, estimatedCost: 0 },
      latencyMs: 100,
      provider: 'OPENAI',
      model: 'gpt-4o',
    });

    decisionService.run.mockResolvedValue({
      decision: 'WAIT',
      confidence: 50,
      regime: { type: 'RANGING' },
      expectedValue: 0,
      profitFactorEstimate: 1,
      expectedWinProbability: 0.5,
      expectedReward: 1,
      expectedLoss: 1,
      executionCost: 0.1,
    });

    const result = await service.research(mockSnapshot, mockContext);

    expect(result.preferred.decisionSource).toBe('AI_WITH_RULES_FALLBACK');
    expect(result.preferred.direction).toBe('WAIT');
  });

  it('should fallback to rules when an alternative thesis fails validation', async () => {
    const longThesis = createBaseThesis('LONG');
    const invalidAltThesis = createBaseThesis('SHORT');
    invalidAltThesis.evidenceFor = [
      { snapshotField: 'does.not.exist', source: 'x', sourceTimestamp: new Date().toISOString(), calculationVersion: 1 }
    ];

    aiOrchestratorService.execute.mockResolvedValue({
      json: {
        preferred: longThesis,
        alternatives: [invalidAltThesis],
      },
      text: '',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, estimatedCost: 0 },
      latencyMs: 100,
      provider: 'OPENAI',
      model: 'gpt-4o',
    });

    decisionService.run.mockResolvedValue({
      decision: 'WAIT',
      confidence: 50,
      regime: { type: 'RANGING' },
      expectedValue: 0,
      profitFactorEstimate: 1,
      expectedWinProbability: 0.5,
      expectedReward: 1,
      expectedLoss: 1,
      executionCost: 0.1,
    });

    const result = await service.research(mockSnapshot, mockContext);

    expect(result.preferred.decisionSource).toBe('AI_WITH_RULES_FALLBACK');
    expect(result.preferred.direction).toBe('WAIT');
  });
  it('fails closed when audit persistence fails', async () => {
    aiOrchestratorService.execute.mockRejectedValue(new Error('timeout'));
    prismaService.agentRun.create.mockRejectedValue(new Error('audit offline'));
    await expect(service.research(mockSnapshot, mockContext)).rejects.toThrow('audit offline');
  });
  it('persists the produced fallback thesis, not an empty provider response', async () => {
    aiOrchestratorService.execute.mockRejectedValue(new Error('timeout'));
    const result = await service.research(mockSnapshot, mockContext);
    expect(prismaService.agentRun.create.mock.calls[0]?.[0]).toMatchObject({ data: { output: { preferred: result.preferred } } });
  });

});
