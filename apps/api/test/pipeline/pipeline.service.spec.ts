import { describe, expect, it, vi } from 'vitest';
import { PipelineService } from '../../src/modules/pipeline/application/pipeline.service';

describe('PipelineService', () => {
  it('queues manual runs so HTTP requests respect worker backpressure', async () => {
    const repository = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      createSteps: vi.fn().mockResolvedValue(undefined),
      updateRun: vi.fn().mockResolvedValue(undefined),
      countRecent: vi.fn().mockResolvedValue(0),
      latestForSymbol: vi.fn().mockResolvedValue(null),
    };
    const queue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    };
    const config = {
      enabled: true,
      maxRunsPerHour: 120,
      cooldownMs: 60_000,
    };
    const runner = {
      run: vi.fn().mockResolvedValue(undefined),
    };

    const service = new PipelineService(repository as never, queue as never, config as never, runner as never);

    const result = await service.trigger(
      'user-1',
      {
        pipelineId: 'FULL_ANALYSIS_DECISION',
        symbol: 'SOL-USDT',
        provider: 'OKX_FUTURES',
        params: {},
      },
      'MANUAL',
    );

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        pipelineId: 'FULL_ANALYSIS_DECISION',
        symbol: 'SOL-USDT',
        provider: 'OKX_FUTURES',
      }),
    );
    expect(runner.run).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'run-1' });
  });

  it('propagates canonical executionContext with deep equality to storedContext and assessPipelineDecision', async () => {
    const { PipelineRunnerService } = await import('../../src/modules/pipeline/application/pipeline-runner.service');
    const { DecisionRiskPolicyService } = await import('../../src/modules/risk/application/decision-risk-policy.service');
    const sampleContext = {
      regime: 'RANGING' as const,
      regimeDetail: 'RANGING_CONSOLIDATION',
      setup: 'RANGE_REVERSION' as const,
      action: 'ENTER' as const,
      riskTier: 'NORMAL' as const,
      sourceDataCutoff: '2026-09-13T12:00:00.000Z',
      usesClosedPrimaryCandle: true,
      triggerConfirmed: true,
      priceLocation: {
        rangePercentile: 0.85,
        distanceFromSupportAtr: 2.1,
        distanceFromResistanceAtr: 0.2,
      },
    };

    const synthesizedDecision = {
      decision: 'SHORT' as const,
      confidence: 85,
      dataQuality: 'GOOD' as const,
      conflictLevel: 'LOW' as const,
      opportunityScore: 78,
      expectedValue: 1.2,
      riskScore: 25,
      adaptiveThreshold: 60,
      volatilityAdjustment: 0,
      agreementScore: 80,
      regime: { type: 'RANGING' as const },
      overrides: [],
      reasoning: 'Ranging upper boundary short.',
      executionContext: sampleContext,
    };

    const freshCloseTime = new Date();
    const fusion = {
      runDetailed: vi.fn().mockResolvedValue({
        analyses: {
          news: { impact: 'LOW' },
          market: { trend: { direction: 'SIDEWAYS', strength: 'WEAK' }, volatility: { level: 'MEDIUM', atr: 0.5 } },
          technical: { trend: { direction: 'SIDEWAYS', strength: 'WEAK' }, structure: {} },
          onchain: {},
          macro: {},
          sentiment: {},
        },
        fusionOutput: { overallScore: 75 },
      }),
    };
    const decision = {
      decideForUser: vi.fn().mockResolvedValue(synthesizedDecision),
      calibrateForExecution: vi.fn().mockImplementation((dec) => Promise.resolve(dec)),
    };
    const repository = {
      updateRun: vi.fn().mockResolvedValue({}),
      updateStep: vi.fn().mockResolvedValue(undefined),
      finishStep: vi.fn().mockResolvedValue(undefined),
      activeStrategyKeys: vi.fn().mockResolvedValue(['ai-core']),
    };
    const marketData = {
      getIndicatorSnapshot: vi.fn().mockResolvedValue({
        candleCloseTime: freshCloseTime,
        values: { rsi14: 65, atr14: 0.8, volumeChangePercent: 2, ema20: 100, ema50: 99 },
      }),
      getHistoricalCandles: vi.fn().mockResolvedValue([
        { open: '100', high: '102', low: '99', close: '101', closeTime: freshCloseTime },
      ]),
    };
    const liveTrading = {
      assessPipelineDecision: vi.fn().mockResolvedValue({
        outcome: 'RISK_APPROVED',
        risk: { approved: true, riskScore: 20 },
      }),
      executePipeline: vi.fn().mockResolvedValue({ outcome: 'EXECUTED' }),
    };
    const redis = {
      setNx: vi.fn().mockResolvedValue(true),
      compareAndDelete: vi.fn().mockResolvedValue(true),
    };

    const judge = {
      evaluate: vi.fn().mockReturnValue({ verdict: 'APPROVE', severity: 'APPROVE', approved: true, reasons: [] }),
    };
    const quantPolicy = {
      evaluate: vi.fn().mockResolvedValue({ severity: 'APPROVE', allowed: true, sizeFactor: 1, reasons: [] }),
    };

    const runner = new PipelineRunnerService(
      fusion as never,
      decision as never,
      repository as never,
      { isCancelled: vi.fn().mockResolvedValue(false) } as never,
      new DecisionRiskPolicyService(),
      { evaluate: vi.fn().mockReturnValue({ allowed: true, preliminaryRegime: 'RANGING' }) },
      marketData as never,
      {
        contextual: vi.fn().mockResolvedValue(undefined),
        decision: vi.fn().mockResolvedValue(undefined),
        repeatedFailure: vi.fn().mockResolvedValue(undefined),
        blockedOpportunity: vi.fn().mockResolvedValue(undefined),
      } as never,
      { recordStageTelemetry: vi.fn() } as never,
      liveTrading as never,
      redis as never,
      judge,
      undefined,
      quantPolicy as never,
    );

    await runner.run({
      pipelineId: 'FULL_ANALYSIS_DECISION',
      runId: 'context-prop-run',
      userId: 'user-1',
      provider: 'OKX_FUTURES',
      symbol: 'ZRO-USDT',
      params: { interval: '15m', strategyIds: ['ai-core'] },
      trigger: 'SCHEDULE',
      createdAt: freshCloseTime.toISOString(),
    } as never);

    expect(liveTrading.assessPipelineDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        tradePlanContext: expect.objectContaining({
          executionContext: sampleContext,
        }) as unknown,
      }),
    );

    expect(repository.updateRun).toHaveBeenCalledWith(
      'context-prop-run',
      expect.objectContaining({
        storedContext: expect.objectContaining({
          executionContext: sampleContext,
        }) as unknown,
      }),
    );

    const lastAssessCall = liveTrading.assessPipelineDecision.mock.calls[0]?.[0] as
      | { tradePlanContext?: { executionContext?: unknown } }
      | undefined;
    const lastUpdateCall = repository.updateRun.mock.calls.find(
      (call: unknown[]) => Boolean((call[1] as { storedContext?: unknown } | undefined)?.storedContext),
    )?.[1] as { storedContext?: { executionContext?: unknown } } | undefined;
    expect(lastAssessCall?.tradePlanContext?.executionContext).toEqual(
      lastUpdateCall?.storedContext?.executionContext,
    );
  });

  it('reconciles open steps to SKIPPED when trigger skips early due to cooldown', async () => {
    const repository = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-cooldown' }),
      createSteps: vi.fn().mockResolvedValue(undefined),
      updateRun: vi.fn().mockResolvedValue(undefined),
      skipOpenSteps: vi.fn().mockResolvedValue({ count: 4 }),
      countRecent: vi.fn().mockResolvedValue(1),
      latestForSymbol: vi.fn().mockResolvedValue({ createdAt: new Date() }),
    };
    const queue = { enqueue: vi.fn() };
    const config = { enabled: true, maxRunsPerHour: 10, cooldownMs: 60_000 };
    const runner = { run: vi.fn() };

    const service = new PipelineService(repository as never, queue as never, config as never, runner as never);

    await service.trigger(
      'user-1',
      {
        pipelineId: 'FULL_ANALYSIS_DECISION',
        symbol: 'BTC-USDT',
        provider: 'OKX_FUTURES',
        params: {},
      },
      'MANUAL',
    );

    expect(repository.updateRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'SKIPPED',
        skippedReason: 'SYMBOL_COOLDOWN_ACTIVE',
      }),
    );
    expect(repository.skipOpenSteps).toHaveBeenCalledWith(
      expect.any(String),
      'SYMBOL_COOLDOWN_ACTIVE',
      expect.any(Date),
    );
  });
});
