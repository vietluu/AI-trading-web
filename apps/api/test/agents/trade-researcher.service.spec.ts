import { TradeResearcherService, TradeResearcherContext } from '../../src/modules/agents/application/services/trade-researcher.service';
import { AnticipatoryMarketSnapshot, TradeThesis } from '@platform/shared';
import { describe, expect, it, beforeEach, vi } from 'vitest';

describe('TradeResearcherService', () => {
  let service: TradeResearcherService;
  let aiOrchestratorService: any;
  let decisionService: any;
  let prismaService: any;

  const mockSnapshot: AnticipatoryMarketSnapshot = {
    symbol: 'BTC-USDT',
    provider: 'BINANCE_FUTURES',
    timeframe: '15m',
    sourceDataCutoff: new Date().toISOString(),
    schemaVersion: 1,
    calculationVersion: 1,
    eligibility: { status: 'ELIGIBLE', reasons: [] },
    structure: { coverage: 'UNAVAILABLE', freshness: 'UNAVAILABLE', observationAgeMs: null, unavailableFields: ['x'], reason: 'y' } as any,
    volatility: { coverage: 'UNAVAILABLE', freshness: 'UNAVAILABLE', observationAgeMs: null, unavailableFields: ['x'], reason: 'y' } as any,
    momentum: { coverage: 'UNAVAILABLE', freshness: 'UNAVAILABLE', observationAgeMs: null, unavailableFields: ['x'], reason: 'y' } as any,
    participation: { coverage: 'UNAVAILABLE', freshness: 'UNAVAILABLE', observationAgeMs: null, unavailableFields: ['x'], reason: 'y' } as any,
    derivatives: { coverage: 'UNAVAILABLE', freshness: 'UNAVAILABLE', observationAgeMs: null, unavailableFields: ['x'], reason: 'y' } as any,
    context: { coverage: 'UNAVAILABLE', freshness: 'UNAVAILABLE', observationAgeMs: null, unavailableFields: ['x'], reason: 'y' } as any,
    execution: { coverage: 'UNAVAILABLE', freshness: 'UNAVAILABLE', observationAgeMs: null, unavailableFields: ['x'], reason: 'y' } as any,
  };

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
    entryZone: direction === 'WAIT' ? null : { lower: 60000, upper: 61000 },
    trigger: [],
    invalidation: direction === 'WAIT' ? null : { price: 59000, reason: 'x' },
    stopLoss: direction === 'WAIT' ? null : 59000,
    targets: direction === 'WAIT' ? [] : [{ price: 63000, fraction: 1 }],
    expectedNetR: direction === 'WAIT' ? null : 2,
    maximumChaseDistanceAtr: 1,
    confidence: 80,
    evidenceFor: [],
    evidenceAgainst: [],
    missingEvidence: [],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });

  beforeEach(() => {
    aiOrchestratorService = {
      execute: vi.fn(),
    };

    decisionService = {
      decideForUser: vi.fn(),
    };
    
    prismaService = {
      agentRun: {
        create: vi.fn(),
      }
    };

    service = new TradeResearcherService(aiOrchestratorService, decisionService, prismaService);
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
    expect(prismaService.agentRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        inputHash: 'hash',
        contextSnapshotId: 'snapshot-id',
        promptVersion: 1,
        provider: 'OPENAI',
        model: 'gpt-4o',
      })
    }));
  });

  it('should fall back to rules and label AI_WITH_RULES_FALLBACK on AI timeout', async () => {
    aiOrchestratorService.execute.mockRejectedValue(new Error('timeout'));
    
    decisionService.decideForUser.mockResolvedValue({
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
    expect(prismaService.agentRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
      })
    }));
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
    
    decisionService.decideForUser.mockResolvedValue({
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

    decisionService.decideForUser.mockResolvedValue({
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
});
