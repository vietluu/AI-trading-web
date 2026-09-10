import { TradeResearcherService, type TradeResearcherContext } from '../../src/modules/agents/application/services/trade-researcher.service';
import { type AnticipatoryMarketSnapshot, type DecisionOutput, type TradeThesis } from '@platform/shared';
import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';

import type { AIOrchestratorService } from '../../src/modules/ai/application/ai-orchestrator.service';
import type { DecisionService } from '../../src/modules/agents/application/services/decision.service';
import type { PrismaService } from '../../src/database/prisma.service';

describe('TradeResearcherService', () => {
  let service: TradeResearcherService;
  let aiOrchestratorService: { execute: Mock<AIOrchestratorService['execute']> };
  let decisionService: { run: Mock<() => Promise<Partial<DecisionOutput>>> };
  let prismaService: { agentRun: { create: Mock<(args: unknown) => Promise<unknown>> } };

  const mockSnapshot: AnticipatoryMarketSnapshot = {
    symbol: 'BTC-USDT',
    provider: 'BINANCE_FUTURES',
    timeframe: '15m',
    sourceDataCutoff: new Date().toISOString(),
    schemaVersion: 1,
    calculationVersion: 1,
    eligibility: { status: 'ELIGIBLE', reasons: [] },
    structure: { coverage: 'UNAVAILABLE', freshness: 'UNAVAILABLE', observationAgeMs: null, unavailableFields: ['x'], reason: 'y' },
    volatility: { coverage: 'AVAILABLE', freshness: 'FRESH', observationAgeMs: 0, freshnessThresholdMs: 60000, calculationVersion: 1, evidence: [], sourceTimestamp: new Date().toISOString(), atr: 1000, atrPercentile: 50, squeezeState: 'NOT_SQUEEZING', squeezeDurationCandles: 0, compressionSlope: 0, expansionState: 'NOT_EXPANDED' },
    momentum: { coverage: 'UNAVAILABLE', freshness: 'UNAVAILABLE', observationAgeMs: null, unavailableFields: ['x'], reason: 'y' },
    participation: { coverage: 'UNAVAILABLE', freshness: 'UNAVAILABLE', observationAgeMs: null, unavailableFields: ['x'], reason: 'y' },
    derivatives: { coverage: 'UNAVAILABLE', freshness: 'UNAVAILABLE', observationAgeMs: null, unavailableFields: ['x'], reason: 'y' },
    context: { coverage: 'UNAVAILABLE', freshness: 'UNAVAILABLE', observationAgeMs: null, unavailableFields: ['x'], reason: 'y' },
    execution: { coverage: 'AVAILABLE', freshness: 'FRESH', observationAgeMs: 0, freshnessThresholdMs: 60000, calculationVersion: 1, evidence: [], sourceTimestamp: new Date().toISOString(), currentPrice: 60500, spread: 1, estimatedRoundTripCost: 0.001, tickSize: 0.1, lotSize: 0.001, currentExposure: 0, priceTooFarFromCandidateZones: false },
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
    invalidation: direction === 'WAIT' ? null : { 
      price: direction === 'SHORT' ? 62000 : 59000, 
      reason: 'x' 
    },
    stopLoss: direction === 'WAIT' ? null : (direction === 'SHORT' ? 62000 : 59000),
    targets: direction === 'WAIT' ? [] : [
      { price: direction === 'SHORT' ? 59000 : 63000, fraction: 1 }
    ],
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
      agentRun: {
        create: vi.fn<(args: unknown) => Promise<unknown>>(),
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
        contextSnapshotId: 'snapshot-id',
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
});
