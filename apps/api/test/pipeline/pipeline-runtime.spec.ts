import { describe, expect, it, vi } from 'vitest';
import type { FusionInput, FusionOutput } from '@platform/shared';
import { cronMatches, validateCron } from '../../src/modules/pipeline/domain/cron';
import { pipelineSkipReason } from '../../src/modules/pipeline/domain/rate-limit';
import { FULL_ANALYSIS_DECISION } from '../../src/modules/pipeline/domain/pipeline.definition';
import { DecisionRiskPolicyService } from '../../src/modules/risk/application/decision-risk-policy.service';
import { PipelineSchedulerService } from '../../src/modules/pipeline/application/pipeline-scheduler.service';
import { PipelineRunnerService } from '../../src/modules/pipeline/application/pipeline-runner.service';
import { PIPELINE_DEAD_LETTER_QUEUE_NAME, PIPELINE_RETRY_QUEUE_NAME, PIPELINE_RUN_QUEUE_NAME } from '../../src/modules/pipeline/infrastructure/pipeline-queue.constants';

type PersistedRunUpdate = {
  status?: string;
  skippedReason?: string;
  result?: {
    blockingGate?: { stage: string; reason: string };
    gates?: Array<{ stage: string; disposition: string }>;
  };
};

describe('Phase 6.6 pipeline runtime policies', () => {
  it('requires fresh pinned fusion on stored-context replay and fails closed when refresh fails', async () => {
    const cutoff = new Date();
    const candle = { provider: 'OKX_FUTURES', symbol: 'BTC-USDT', interval: '15m',
      openTime: new Date(cutoff.getTime() - 899999), closeTime: cutoff,
      open: '100', high: '102', low: '99', close: '101', volume: '100', isClosed: true };
    const repository = { updateRun: vi.fn().mockResolvedValue({}), updateStep: vi.fn().mockResolvedValue({}),
      activeStrategyKeys: vi.fn().mockResolvedValue(['ai-core']),
      findRun: vi.fn().mockResolvedValue({ storedContext: { analyses: {}, fusionOutput: {} } }) };
    const fusion = { runDetailed: vi.fn().mockRejectedValue(new Error('Pinned fusion refresh unavailable')) };
    const liveTrading = { assessPipelineDecision: vi.fn(), executePipeline: vi.fn() };
    const service = new PipelineRunnerService(fusion as never,
      { decideForUser: vi.fn().mockRejectedValue(new Error('Stale stored analysis reached decision')) } as never,
      repository as never, { isCancelled: vi.fn().mockResolvedValue(false) } as never,
      {} as never, { evaluate: vi.fn().mockReturnValue({ allowed: true }) },
      { getHistoricalCandles: vi.fn().mockResolvedValue([candle]),
        getIndicatorSnapshot: vi.fn().mockResolvedValue({ provider: candle.provider, symbol: candle.symbol, interval: candle.interval,
          status: 'CLOSED', candleOpenTime: candle.openTime, candleCloseTime: cutoff,
          values: { ema20: '100', ema50: '99', rsi14: '55', atr14: '2' } }) } as never,
      { repeatedFailure: vi.fn().mockResolvedValue(undefined) } as never, {} as never,
      liveTrading as never, {} as never);
    await expect(service.run({ pipelineId: 'FULL_ANALYSIS_DECISION', runId: 'replay-pinned', userId: 'user-1',
      provider: 'OKX_FUTURES', symbol: 'BTC-USDT', params: { interval: '15m' }, trigger: 'EVENT',
      useStoredContext: true } as never)).rejects.toThrow('Pinned fusion refresh unavailable');
    expect(fusion.runDetailed).toHaveBeenCalledWith(expect.objectContaining({
      coreSnapshot: expect.objectContaining({ sourceCutoff: cutoff }) as unknown,
    }));
    expect(liveTrading.assessPipelineDecision).not.toHaveBeenCalled();
    expect(liveTrading.executePipeline).not.toHaveBeenCalled();
  });

  it('validates and matches five-field cron expressions in the requested timezone', () => {
    expect(() => validateCron('*/5 * * * *')).not.toThrow();
    expect(() => validateCron('* * *')).toThrow();
    expect(cronMatches('30 9 * * 1-5', new Date('2026-08-03T09:30:00Z'), 'UTC')).toBe(true);
    expect(cronMatches('30 9 * * 1-5', new Date('2026-08-03T09:31:00Z'), 'UTC')).toBe(false);
  });

  it('enforces hourly quota and symbol cooldown while allowing explicit replay', () => {
    const now = new Date('2026-08-01T12:00:00Z'); const latestCreatedAt = new Date(now.getTime() - 10_000);
    expect(pipelineSkipReason({ hourlyCount: 60, hourlyLimit: 60, now, cooldownMs: 60_000, replay: false })).toBe('MAX_RUNS_PER_HOUR');
    expect(pipelineSkipReason({ hourlyCount: 1, hourlyLimit: 60, latestCreatedAt, now, cooldownMs: 60_000, replay: false })).toBe('SYMBOL_COOLDOWN_ACTIVE');
    expect(pipelineSkipReason({ hourlyCount: 1, hourlyLimit: 60, latestCreatedAt, now, cooldownMs: 60_000, replay: true })).toBeUndefined();
  });

  it('gates decisions on adaptive thresholds, EV and opportunity quality', () => {
    const service = new DecisionRiskPolicyService();
    const output = {
      decision: 'LONG',
      confidence: 62,
      dataQuality: 'GOOD',
      conflictLevel: 'LOW',
      opportunityScore: 74,
      expectedValue: 0.2,
      riskScore: 45,
      adaptiveThreshold: 62,
      volatilityAdjustment: 0,
      agreementScore: 70,
      regime: { type: 'RANGING' },
    };
    const context = { symbol: 'ALGO-USDT' };
    expect(service.evaluate(output as never, context)).toEqual({ actionable: true, decision: 'LONG' });
    expect(service.evaluate({ ...output, confidence: 55 } as never, context)).toEqual({ actionable: false, decision: 'WAIT', reason: 'CONFIDENCE_BELOW_THRESHOLD' });
    expect(service.evaluate({ ...output, expectedValue: -0.05 } as never, context)).toEqual({ actionable: false, decision: 'WAIT', reason: 'EXPECTED_VALUE_NEGATIVE' });
    expect(service.evaluate({ ...output, opportunityScore: 56 } as never, context)).toEqual({ actionable: false, decision: 'WAIT', reason: 'OPPORTUNITY_BELOW_THRESHOLD' });
    expect(service.evaluate({ ...output, dataQuality: 'INSUFFICIENT' } as never, context)).toEqual({ actionable: false, decision: 'WAIT', reason: 'DATA_QUALITY_INSUFFICIENT' });
    expect(service.evaluate({ ...output, dataQuality: 'PARTIAL', confidence: 62 } as never, context)).toEqual({ actionable: false, decision: 'WAIT', reason: 'PARTIAL_DATA_CONVICTION_TOO_LOW' });
    expect(service.evaluate({
      ...output,
      dataQuality: 'PARTIAL',
      coreDataQuality: 'GOOD',
      directionalAgreement: 100,
      evidenceCoverage: 100,
      confidence: 65,
    } as never, context)).toEqual({ actionable: true, decision: 'LONG' });
    expect(service.evaluate({ ...output, conflictLevel: 'HIGH' } as never, context)).toEqual({ actionable: false, decision: 'WAIT', reason: 'HIGH_CONFLICT' });
    expect(service.evaluate({
      ...output,
      confidence: 55,
      coreDataQuality: 'GOOD',
      directionalAgreement: 100,
      evidenceCoverage: 100,
      expectedValue: 0.8,
    } as never, context)).toEqual({
      actionable: false,
      decision: 'WAIT',
      reason: 'CONFIDENCE_BELOW_THRESHOLD',
    });
  });

  it('uses bounded exponential retry settings for safe research jobs', () => {
    expect(FULL_ANALYSIS_DECISION.retryPolicy).toEqual({ attempts: 2, backoffMs: 5000 });
    expect(FULL_ANALYSIS_DECISION.steps.at(-1)?.type).toBe('DECISION');
  });

  it('skips before analysis when none of the requested strategies are active', async () => {
    const repository = {
      updateRun: vi.fn().mockResolvedValue({}),
      activeStrategyKeys: vi.fn().mockResolvedValue([]),
    };
    const fusion = { runDetailed: vi.fn() };
    const service = new PipelineRunnerService(
      fusion as never,
      {} as never,
      repository as never,
      { isCancelled: vi.fn().mockResolvedValue(false) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.run({
      pipelineId: 'FULL_ANALYSIS_DECISION',
      runId: 'scope-run',
      userId: 'user-1',
      provider: 'OKX_FUTURES',
      symbol: 'SOL-USDT',
      params: { strategyIds: ['trend'] },
      trigger: 'SCHEDULE',
    } as never);

    expect(fusion.runDetailed).not.toHaveBeenCalled();
    expect(repository.updateRun).toHaveBeenLastCalledWith('scope-run', expect.objectContaining({
      status: 'SKIPPED',
      decision: 'WAIT',
      skippedReason: 'NO_ACTIVE_STRATEGY',
    }));
  });

  it('persists canonical gate provenance across blocked, approved, failed, and reassessment outcomes', async () => {
    const repository = {
      updateRun: vi.fn().mockResolvedValue({}),
      updateStep: vi.fn().mockResolvedValue({}),
      findRun: vi.fn().mockResolvedValue(undefined),
      activeStrategyKeys: vi.fn().mockImplementation(
        (_userId: string, keys: string[]) => Promise.resolve(keys),
      ),
    };
    const fusionResult = {
        analyses: {
          market: { summary: 'market', trend: { direction: 'UP', strength: 'STRONG' }, volatility: { level: 'MEDIUM' }, liquidity: {}, derivatives: {}, anomalies: [], dataQuality: 'GOOD', usedTools: [], generatedAt: new Date().toISOString() },
          technical: { summary: 'tech', trend: { direction: 'UP', strength: 'STRONG' }, momentum: { rsi: '58', rsiState: 'NEUTRAL', macd: { trend: 'BULLISH' } }, movingAverages: { alignment: 'BULLISH', pricePosition: 'ABOVE' }, volatility: { bollinger: { position: 'MIDDLE', squeeze: false } }, structure: { marketStructure: 'HH_HL' }, divergence: {}, signals: [], dataQuality: 'GOOD', usedTools: [], generatedAt: new Date().toISOString() },
          news: { summary: 'news', impact: { level: 'LOW', direction: 'NEUTRAL' }, keyEvents: [], themes: [], riskSignals: [], dataQuality: 'GOOD', usedTools: [], generatedAt: new Date().toISOString() },
          sentiment: { summary: 'sentiment', sentiment: { overall: 'BULLISH', intensity: 'MEDIUM' }, crowdBehavior: { fomo: false, panic: false, euphoria: false }, sources: {}, anomalies: [], dataQuality: 'GOOD', usedTools: [], generatedAt: new Date().toISOString() },
          macro: { summary: 'macro', macroTrend: 'RISK_ON', keyEvents: [], riskFactors: [], dataQuality: 'GOOD', generatedAt: new Date().toISOString() },
          onchain: { summary: 'onchain', activity: 'HIGH', flows: { exchangeInflow: 'rising' }, signals: [], dataQuality: 'GOOD', generatedAt: new Date().toISOString() },
        },
        fusionOutput: {
          summary: 'fusion',
          combinedAnalysis: { news: 'news', sentiment: 'sentiment', macro: 'macro', market: 'market', technical: 'technical', onchain: 'onchain' },
          overallBias: 'BULLISH', confidence: 70, conflicts: [], dataQuality: 'GOOD', generatedAt: new Date().toISOString(),
        },
      } as { analyses: FusionInput; fusionOutput: FusionOutput };
    const fusion = {
      runDetailed: vi.fn().mockResolvedValue(fusionResult),
    };
    const decision = {
      decideForUser: vi.fn().mockResolvedValue({
        decision: 'LONG',
        confidence: 55,
        reasoning: 'too weak',
        signals: { bullishFactors: [], bearishFactors: [] },
        risks: [],
        agreementScore: 60,
        dataQuality: 'GOOD',
        regime: { type: 'TRENDING' },
        weighting: { market: 20, technical: 25, news: 15, sentiment: 15, macro: 15, onchain: 10 },
        overrides: [],
        volatilityAdjustment: 0,
        conflictLevel: 'LOW',
        opportunityScore: 60,
        expectedWinProbability: 0.6,
        expectedReward: 1.2,
        expectedLoss: 0.8,
        expectedValue: 0.12,
        profitFactorEstimate: 1.5,
        riskScore: 44,
        adaptiveThreshold: 62,
        calibrationAdjustment: 0,
        executionCost: 0.04,
        generatedAt: new Date().toISOString(),
      }),
      calibrateForExecution: vi.fn().mockImplementation((value: unknown) => Promise.resolve(value)),
    };
    const riskPolicy = { evaluate: vi.fn().mockReturnValue({ actionable: false, decision: 'WAIT', reason: 'CONFIDENCE_BELOW_THRESHOLD' }) };
    const signalFilter = { evaluate: vi.fn().mockReturnValue({ allowed: true, preliminaryRegime: 'TRENDING' }) };
    const freshCloseTime = new Date();
    const marketData = {
      getIndicatorSnapshot: vi.fn().mockResolvedValue({ candleCloseTime: freshCloseTime, values: { rsi14: 55, atr14: 0.8, volumeChangePercent: 3, ema20: 100, ema50: 99, ema200: 95 } }),
      getHistoricalCandles: vi.fn().mockResolvedValue([{ close: '100', closeTime: freshCloseTime }]),
    };
    const alerts = {
      contextual: vi.fn().mockResolvedValue(undefined),
      decision: vi.fn().mockResolvedValue(undefined),
      repeatedFailure: vi.fn().mockResolvedValue(undefined),
      blockedOpportunity: vi.fn().mockResolvedValue(undefined),
    };
    const analytics = { recordStageTelemetry: vi.fn() };
    const liveTrading = {
      assessPipelineDecision: vi.fn().mockResolvedValue({ outcome: 'RISK_APPROVED', risk: { approved: true, reason: 'ok', riskScore: 20 } }),
      executePipeline: vi.fn().mockResolvedValue({ outcome: 'EXECUTED' }),
    };
    const redis = {
      setNx: vi.fn().mockResolvedValue(true),
      compareAndDelete: vi.fn().mockResolvedValue(true),
    };
    const service = new PipelineRunnerService(
      fusion as never,
      decision as never,
      repository as never,
      { isCancelled: vi.fn().mockResolvedValue(false) } as never,
      riskPolicy,
      signalFilter,
      marketData as never,
      alerts as never,
      analytics as never,
      liveTrading as never,
      redis as never,
    );
    const persistedUpdate = (id: string, status?: string) =>
      (repository.updateRun.mock.calls as unknown as Array<[string, PersistedRunUpdate]>)
        .find(([runId, update]) =>
          runId === id && (status === undefined
            ? update.result !== undefined
            : update.status === status),
        )?.[1];

    await service.run({
      pipelineId: 'FULL_ANALYSIS_DECISION',
      runId: 'run-1',
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'BTC-USDT',
      params: { interval: '1h', strategyIds: ['ai-core', 'trend', 'breakout'] },
      trigger: 'EVENT',
    } as never);

    expect(liveTrading.assessPipelineDecision).not.toHaveBeenCalled();
    expect(liveTrading.executePipeline).not.toHaveBeenCalled();
    expect(alerts.decision).not.toHaveBeenCalled();
    expect(repository.updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
      status: 'COMPLETED', decision: 'WAIT', skippedReason: 'CONFIDENCE_BELOW_THRESHOLD',
    }));
    expect(JSON.stringify(repository.updateRun.mock.calls)).toContain('"selectedStrategyKey":"trend"');
    expect(JSON.stringify(repository.updateRun.mock.calls)).toContain('"candidateDecision"');

    riskPolicy.evaluate.mockReturnValue({ actionable: true, decision: 'LONG' });
    const waitingExecutionContext = {
      regime: 'TRENDING' as const,
      setup: 'TREND_PULLBACK' as const,
      action: 'WAIT' as const,
      riskTier: 'NONE' as const,
      sourceDataCutoff: freshCloseTime.toISOString(),
      usesClosedPrimaryCandle: true,
      triggerConfirmed: true,
      priceLocation: {},
    };
    decision.calibrateForExecution.mockImplementation((value: Record<string, unknown>) =>
      Promise.resolve({ ...value, executionContext: waitingExecutionContext }),
    );
    const readinessBlockedService = new PipelineRunnerService(
      fusion as never,
      decision as never,
      repository as never,
      { isCancelled: vi.fn().mockResolvedValue(false) } as never,
      riskPolicy,
      signalFilter,
      marketData as never,
      alerts as never,
      analytics as never,
      liveTrading as never,
      redis as never,
      undefined,
      undefined,
      { evaluate: vi.fn().mockResolvedValue({ allowed: true, evaluated: true }) } as never,
    );

    await readinessBlockedService.run({
      pipelineId: 'FULL_ANALYSIS_DECISION',
      runId: 'run-readiness-blocked',
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'ETH-USDT',
      params: { interval: '1h', strategyIds: ['ai-core', 'trend'] },
      trigger: 'EVENT',
    } as never);

    expect(liveTrading.assessPipelineDecision).not.toHaveBeenCalled();
    expect(liveTrading.executePipeline).not.toHaveBeenCalled();
    expect(repository.updateRun).toHaveBeenCalledWith('run-readiness-blocked', expect.objectContaining({
      status: 'COMPLETED', decision: 'WAIT', skippedReason: 'ENTRY_ACTION_NOT_EXECUTABLE',
    }));
    const readinessBlockedRun = persistedUpdate('run-readiness-blocked', 'COMPLETED');
    expect(readinessBlockedRun?.result?.gates).toContainEqual(expect.objectContaining({
      stage: 'EXECUTION_READINESS', disposition: 'BLOCK',
    }));

    decision.calibrateForExecution.mockImplementation((value: Record<string, unknown>) =>
      Promise.resolve({
        ...value,
        executionContext: {
          ...waitingExecutionContext,
          action: 'ENTER' as const,
          riskTier: 'NORMAL' as const,
        },
      }),
    );
    liveTrading.executePipeline.mockResolvedValue({ outcome: 'ORDER_SUBMITTED' });
    const approvedService = new PipelineRunnerService(
      fusion as never,
      decision as never,
      repository as never,
      { isCancelled: vi.fn().mockResolvedValue(false) } as never,
      riskPolicy,
      signalFilter,
      marketData as never,
      alerts as never,
      analytics as never,
      liveTrading as never,
      redis as never,
      undefined,
      undefined,
      { evaluate: vi.fn().mockResolvedValue({ allowed: true, evaluated: true }) } as never,
    );

    await approvedService.run({
      pipelineId: 'FULL_ANALYSIS_DECISION',
      runId: 'run-2',
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'ETH-USDT',
      params: { interval: '1h', strategyIds: ['ai-core', 'trend'] },
      trigger: 'EVENT',
    } as never);

    expect(liveTrading.assessPipelineDecision).toHaveBeenCalledTimes(1);
    expect(liveTrading.executePipeline).toHaveBeenCalledWith('user-1', 'run-2');
    expect(redis.compareAndDelete).toHaveBeenCalled();
    expect(repository.updateRun).toHaveBeenCalledWith('run-2', expect.objectContaining({
      status: 'COMPLETED', decision: 'LONG', skippedReason: null,
    }));
    const approvedRun = persistedUpdate('run-2', 'COMPLETED');
    expect(approvedRun?.result?.gates).toEqual([
      expect.objectContaining({ stage: 'SIGNAL_FILTER', disposition: 'PASS' }),
      expect.objectContaining({ stage: 'EXECUTION_READINESS', disposition: 'PASS' }),
      expect.objectContaining({ stage: 'JUDGE', disposition: 'PASS' }),
      expect.objectContaining({ stage: 'QUANT', disposition: 'PASS' }),
      expect.objectContaining({ stage: 'MULTI_TIMEFRAME', disposition: 'PASS' }),
      expect.objectContaining({ stage: 'RISK', disposition: 'PASS' }),
      expect.objectContaining({ stage: 'EXECUTION', disposition: 'PASS' }),
    ]);
    expect(approvedRun?.result?.blockingGate).toBeUndefined();

    repository.updateRun.mockClear();
    liveTrading.assessPipelineDecision.mockImplementationOnce(() => {
      const evaluatedRun = persistedUpdate('run-risk-failure');
      expect(evaluatedRun?.result?.gates).toEqual([
        expect.objectContaining({ stage: 'SIGNAL_FILTER', disposition: 'PASS' }),
        expect.objectContaining({ stage: 'EXECUTION_READINESS', disposition: 'PASS' }),
        expect.objectContaining({ stage: 'JUDGE', disposition: 'PASS' }),
        expect.objectContaining({ stage: 'QUANT', disposition: 'PASS' }),
        expect.objectContaining({ stage: 'MULTI_TIMEFRAME', disposition: 'PASS' }),
      ]);
      return Promise.resolve({ outcome: 'NO_ELIGIBLE_EXCHANGE_CONNECTION' });
    });

    await expect(approvedService.run({
      pipelineId: 'FULL_ANALYSIS_DECISION',
      runId: 'run-risk-failure',
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'ETH-USDT',
      params: { interval: '1h', strategyIds: ['ai-core', 'trend'] },
      trigger: 'EVENT',
    } as never)).rejects.toThrow('NO_ELIGIBLE_EXCHANGE_CONNECTION');

    const failedAfterEvaluationRun = persistedUpdate('run-risk-failure', 'FAILED');
    expect(failedAfterEvaluationRun?.result?.gates).toEqual([
      expect.objectContaining({ stage: 'SIGNAL_FILTER', disposition: 'PASS' }),
      expect.objectContaining({ stage: 'EXECUTION_READINESS', disposition: 'PASS' }),
      expect.objectContaining({ stage: 'JUDGE', disposition: 'PASS' }),
      expect.objectContaining({ stage: 'QUANT', disposition: 'PASS' }),
      expect.objectContaining({ stage: 'MULTI_TIMEFRAME', disposition: 'PASS' }),
      expect.objectContaining({
        stage: 'RISK',
        disposition: 'BLOCK',
      }),
    ]);
    expect(failedAfterEvaluationRun?.result?.blockingGate).toEqual({
      stage: 'RISK',
      reason: 'NO_ELIGIBLE_EXCHANGE_CONNECTION',
    });
    expect(failedAfterEvaluationRun?.skippedReason).toBe('NO_ELIGIBLE_EXCHANGE_CONNECTION');

    repository.updateRun.mockClear();
    liveTrading.assessPipelineDecision.mockRejectedValueOnce(
      new Error('NO_ELIGIBLE_EXCHANGE_CONNECTION: connection lookup failed'),
    );

    await expect(approvedService.run({
      pipelineId: 'FULL_ANALYSIS_DECISION',
      runId: 'run-risk-exception',
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'ETH-USDT',
      params: { interval: '1h', strategyIds: ['ai-core', 'trend'] },
      trigger: 'EVENT',
    } as never)).rejects.toThrow('NO_ELIGIBLE_EXCHANGE_CONNECTION');

    const failedRiskExceptionRun = persistedUpdate('run-risk-exception', 'FAILED');
    expect(failedRiskExceptionRun?.result?.gates?.at(-1)).toEqual(
      expect.objectContaining({ stage: 'RISK', disposition: 'BLOCK' }),
    );
    expect(failedRiskExceptionRun?.result?.blockingGate).toEqual({
      stage: 'RISK',
      reason: 'NO_ELIGIBLE_EXCHANGE_CONNECTION',
    });
    expect(failedRiskExceptionRun?.skippedReason).toBe('NO_ELIGIBLE_EXCHANGE_CONNECTION');

    repository.updateRun.mockClear();
    liveTrading.assessPipelineDecision.mockResolvedValueOnce({
      outcome: 'RISK_APPROVED',
      risk: { approved: true, reason: 'ok', riskScore: 20 },
    });
    liveTrading.executePipeline.mockRejectedValueOnce(new Error('exchange unavailable'));

    await expect(approvedService.run({
      pipelineId: 'FULL_ANALYSIS_DECISION',
      runId: 'run-execution-failure',
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'ETH-USDT',
      params: { interval: '1h', strategyIds: ['ai-core', 'trend'] },
      trigger: 'EVENT',
    } as never)).rejects.toThrow('exchange unavailable');

    const failedDuringExecutionRun = persistedUpdate('run-execution-failure', 'FAILED');
    expect(failedDuringExecutionRun?.result?.gates?.slice(-2)).toEqual([
      expect.objectContaining({ stage: 'RISK', disposition: 'PASS' }),
      expect.objectContaining({ stage: 'EXECUTION', disposition: 'BLOCK' }),
    ]);
    expect(failedDuringExecutionRun?.result?.blockingGate).toEqual({
      stage: 'EXECUTION',
      reason: 'PIPELINE_EXECUTION_FAILED',
    });
    expect(failedDuringExecutionRun?.skippedReason).toBe('PIPELINE_EXECUTION_FAILED');

    repository.updateRun.mockClear();
    liveTrading.assessPipelineDecision
      .mockResolvedValueOnce({
        outcome: 'RISK_APPROVED',
        risk: { approved: true, reason: 'ok', riskScore: 20 },
      })
      .mockRejectedValueOnce(
        new Error('NO_ELIGIBLE_EXCHANGE_CONNECTION: reassessment connection lookup failed'),
      );
    liveTrading.executePipeline.mockResolvedValueOnce({
      outcome: 'EXECUTION_FAILED',
      errorCode: 'ENTRY_PRICE_DRIFT',
      retryable: true,
    });

    await expect(approvedService.run({
      pipelineId: 'FULL_ANALYSIS_DECISION',
      runId: 'run-reassessment-failure',
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'ETH-USDT',
      params: { interval: '1h', strategyIds: ['ai-core', 'trend'] },
      trigger: 'EVENT',
    } as never)).rejects.toThrow('NO_ELIGIBLE_EXCHANGE_CONNECTION');

    const failedReassessmentRun = persistedUpdate('run-reassessment-failure', 'FAILED');
    expect(failedReassessmentRun?.result?.gates?.at(-1)).toEqual(
      expect.objectContaining({ stage: 'RISK', disposition: 'BLOCK' }),
    );
    expect(failedReassessmentRun?.result?.gates).not.toContainEqual(
      expect.objectContaining({ stage: 'EXECUTION' }),
    );
    expect(failedReassessmentRun?.result?.blockingGate).toEqual({
      stage: 'RISK',
      reason: 'NO_ELIGIBLE_EXCHANGE_CONNECTION',
    });
    expect(failedReassessmentRun?.skippedReason).toBe('NO_ELIGIBLE_EXCHANGE_CONNECTION');

    repository.updateRun.mockClear();
    const provenanceService = new PipelineRunnerService(
      fusion as never,
      decision as never,
      repository as never,
      { isCancelled: vi.fn().mockResolvedValue(false) } as never,
      riskPolicy,
      signalFilter,
      marketData as never,
      alerts as never,
      analytics as never,
      liveTrading as never,
      redis as never,
      {
        evaluate: vi.fn().mockReturnValue({
          verdict: 'APPROVE',
          severity: 'APPROVE',
          approved: true,
          reasons: ['VALID_EXACT_EVIDENCE'],
        }),
      },
      undefined,
      {
        evaluate: vi.fn().mockResolvedValue({
          severity: 'BLOCK',
          allowed: false,
          evaluated: false,
          reason: 'QUANT_ASSUMPTION_MISMATCH',
          reasons: ['ASSUMPTION_MISMATCH_LIVE'],
        }),
      } as never,
    );

    await provenanceService.run({
      pipelineId: 'FULL_ANALYSIS_DECISION',
      runId: 'run-quant-block',
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'ETH-USDT',
      params: { interval: '1h', strategyIds: ['ai-core'] },
      trigger: 'EVENT',
    } as never);

    const quantBlockedRun = (repository.updateRun.mock.calls as unknown as Array<[
      string,
      {
        status?: string;
        skippedReason?: string;
        result?: {
          blockingGate?: { stage: string; reason: string };
          gates?: Array<{ stage: string; disposition: string }>;
        };
      },
    ]>).find(([id, update]) => id === 'run-quant-block' && update.status === 'COMPLETED')?.[1];
    expect(quantBlockedRun?.result?.blockingGate).toEqual({
      stage: 'QUANT',
      reason: 'QUANT_ASSUMPTION_MISMATCH',
    });
    expect(quantBlockedRun?.skippedReason).toBe('QUANT_ASSUMPTION_MISMATCH');
    expect(quantBlockedRun?.result?.gates).toContainEqual(expect.objectContaining({
      stage: 'JUDGE',
      disposition: 'PASS',
    }));
    expect(analytics.recordStageTelemetry).toHaveBeenCalledWith(expect.objectContaining({
      rejectReason: 'QUANT_ASSUMPTION_MISMATCH',
      blockingStage: 'QUANT',
    }));

    vi.clearAllMocks();
    const fallbackFusion: typeof fusionResult = {
      ...fusionResult,
      analyses: {
        ...fusionResult.analyses,
        market: {
          ...fusionResult.analyses.market,
          trend: { ...fusionResult.analyses.market.trend, strength: 'MODERATE' },
        },
        technical: {
          ...fusionResult.analyses.technical,
          trend: { ...fusionResult.analyses.technical.trend, strength: 'MODERATE' },
        },
      },
    };
    fusion.runDetailed.mockResolvedValue(fallbackFusion);
    marketData.getIndicatorSnapshot.mockResolvedValue({
      candleCloseTime: freshCloseTime,
      values: {
        rsi14: 55,
        atr14: 0.8,
        priceChangePercent: -0.8,
        volumeChangePercent: 3,
        adx14: 24,
        efficiencyRatio20: 0.4,
        ema20: 99,
        ema50: 100,
        ema200: 95,
      },
    });
    riskPolicy.evaluate.mockReturnValue({ actionable: true, decision: 'LONG' });
    const fallbackJudge = {
      evaluate: vi.fn((value: { decision: string }) => value.decision === 'SHORT'
        ? { verdict: 'REJECT', approved: false, reasons: ['DIRECTION_REJECTED'] }
        : { verdict: 'APPROVE', approved: true, reasons: [] }),
    };
    const fallbackService = new PipelineRunnerService(
      fusion as never,
      decision as never,
      repository as never,
      { isCancelled: vi.fn().mockResolvedValue(false) } as never,
      riskPolicy,
      signalFilter,
      marketData as never,
      alerts as never,
      analytics as never,
      liveTrading as never,
      redis as never,
      fallbackJudge as never,
      undefined,
      { evaluate: vi.fn().mockResolvedValue({ allowed: true, evaluated: true }) } as never,
    );

    await fallbackService.run({
      pipelineId: 'FULL_ANALYSIS_DECISION',
      runId: 'run-3',
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'BTC-USDT',
      params: { interval: '15m', strategyIds: ['ai-core', 'trend', 'momentum-scalp'] },
      trigger: 'EVENT',
    } as never);

    expect(repository.updateRun).toHaveBeenCalledWith('run-3', expect.objectContaining({
      status: 'COMPLETED', decision: 'LONG', skippedReason: null,
    }));
    const fallbackCalls = JSON.stringify(repository.updateRun.mock.calls);
    expect(fallbackCalls).toContain('"initialSelectedStrategyKey":"momentum-scalp"');
    expect(fallbackCalls).toContain('"selectedStrategyKey":"trend"');
    expect(fallbackCalls).toContain('"strategyKey":"momentum-scalp","decision":"SHORT"');
    expect(fallbackCalls).toContain('"strategyKey":"trend","decision":"LONG"');
  });

  it('routes a confirmed DEMO dislocation canary through risk while preserving historical gate reasons as advisory', async () => {
    const now = new Date();
    const repository = {
      updateRun: vi.fn().mockResolvedValue({}),
      updateStep: vi.fn().mockResolvedValue({}),
      findRun: vi.fn().mockResolvedValue(undefined),
      activeStrategyKeys: vi.fn().mockImplementation(
        (_userId: string, keys: string[]) => Promise.resolve(keys),
      ),
    };
    const analyses = {
      market: { summary: 'market', trend: { direction: 'UP', strength: 'STRONG' }, volatility: { level: 'MEDIUM', atr: '0.8' }, liquidity: {}, derivatives: {}, anomalies: [], dataQuality: 'GOOD', usedTools: [], generatedAt: now.toISOString() },
      technical: { summary: 'tech', trend: { direction: 'UP', strength: 'STRONG' }, momentum: { rsi: '58', rsiState: 'NEUTRAL', macd: { trend: 'BULLISH' } }, movingAverages: { alignment: 'BULLISH', pricePosition: 'ABOVE' }, volatility: { bollinger: { position: 'MIDDLE', squeeze: false } }, structure: { marketStructure: 'HH_HL', breakout: true }, divergence: {}, signals: [], dataQuality: 'GOOD', usedTools: [], generatedAt: now.toISOString() },
      news: { summary: 'news', impact: { level: 'LOW', direction: 'NEUTRAL' }, keyEvents: [], themes: [], riskSignals: [], dataQuality: 'GOOD', usedTools: [], generatedAt: now.toISOString() },
      sentiment: { summary: 'sentiment', sentiment: { overall: 'BULLISH', intensity: 'MEDIUM' }, crowdBehavior: { fomo: false, panic: false, euphoria: false }, sources: {}, anomalies: [], dataQuality: 'GOOD', usedTools: [], generatedAt: now.toISOString() },
      macro: { summary: 'macro', macroTrend: 'RISK_ON', keyEvents: [], riskFactors: [], dataQuality: 'GOOD', generatedAt: now.toISOString() },
      onchain: { summary: 'onchain', activity: 'HIGH', flows: { exchangeInflow: 'falling' }, signals: [], dataQuality: 'GOOD', generatedAt: now.toISOString() },
    } as unknown as FusionInput;
    const fusion = {
      runDetailed: vi.fn().mockResolvedValue({
        analyses,
        fusionOutput: {
          summary: 'fusion',
          combinedAnalysis: { news: 'news', sentiment: 'sentiment', macro: 'macro', market: 'market', technical: 'technical', onchain: 'onchain' },
          overallBias: 'BULLISH', confidence: 75, conflicts: [], dataQuality: 'GOOD', generatedAt: now.toISOString(),
        } as FusionOutput,
      }),
    };
    const output = {
      decision: 'LONG', confidence: 75, reasoning: 'confirmed impulse',
      signals: { bullishFactors: ['market', 'technical'], bearishFactors: [] }, risks: [],
      agreementScore: 100, directionalAgreement: 100, evidenceCoverage: 100,
      coreDataQuality: 'GOOD', dataQuality: 'GOOD', regime: { type: 'TRENDING' },
      weighting: { market: 20, technical: 30, news: 10, sentiment: 15, macro: 15, onchain: 10 },
      overrides: [], volatilityAdjustment: 0, conflictLevel: 'LOW', opportunityScore: 79,
      expectedWinProbability: 0.3, expectedReward: 2.8, expectedLoss: 0.7,
      expectedValue: -0.1, profitFactorEstimate: 1, riskScore: 54,
      adaptiveThreshold: 60, calibrationAdjustment: 0, executionCost: 0.06,
      executionContext: {
        regime: 'TRENDING', setup: 'TREND_PULLBACK', action: 'ENTER', riskTier: 'NORMAL',
        sourceDataCutoff: now.toISOString(), usesClosedPrimaryCandle: true,
        triggerConfirmed: true, priceLocation: {},
      },
      generatedAt: now.toISOString(),
    };
    const decision = {
      decideForUser: vi.fn().mockResolvedValue(output),
      calibrateForExecution: vi.fn().mockImplementation((value: unknown) => Promise.resolve(value)),
    };
    const marketData = {
      getIndicatorSnapshot: vi.fn().mockResolvedValue({
        candleOpenTime: new Date(now.getTime() - 5 * 60_000),
        candleCloseTime: now,
        values: {
          rsi14: 58, atr14: 0.8, volumeChangePercent: 180,
          priceChangePercent: 0.9, ema20: 100, ema50: 99, ema200: 95,
          adx14: 30, efficiencyRatio20: 0.6, rollingHigh: 100.2,
        },
      }),
      getHistoricalCandles: vi.fn().mockResolvedValue([{ close: '100.4', closeTime: now }]),
    };
    const liveTrading = {
      assessPipelineDecision: vi.fn().mockResolvedValue({ outcome: 'RISK_APPROVED', risk: { approved: true, riskScore: 20 } }),
      executePipeline: vi.fn().mockResolvedValue({ outcome: 'ORDER_SUBMITTED' }),
    };
    const quant = {
      evaluate: vi.fn().mockImplementation((input: { mode?: string; marketDislocation?: { direction?: string } }) =>
        Promise.resolve(input.mode === 'DEMO' && input.marketDislocation?.direction === 'BULLISH'
          ? { allowed: true, evaluated: true, advisory: true, dislocationCanary: true, reason: 'QUANT_WALK_FORWARD_UNSTABLE', sizeFactor: 0.1 }
          : { allowed: false, reason: 'QUANT_WALK_FORWARD_UNSTABLE' })),
    };
    const redis = { setNx: vi.fn().mockResolvedValue(true), compareAndDelete: vi.fn().mockResolvedValue(true) };
    const signalFilter = {
      evaluate: vi.fn().mockReturnValue({
        actionable: false,
        decision: 'WAIT',
        reason: 'EXPECTED_VALUE_NEGATIVE',
      }),
    };
    const decisionJudge = {
      evaluate: vi.fn().mockReturnValue({
        verdict: 'REQUEST_MORE_DATA',
        approved: false,
        reasons: ['CALIBRATED_PROBABILITY_TOO_LOW'],
      }),
    };
    const service = new PipelineRunnerService(
      fusion as never,
      decision as never,
      repository as never,
      { isCancelled: vi.fn().mockResolvedValue(false) } as never,
      signalFilter,
      { evaluate: vi.fn().mockReturnValue({ allowed: true, preliminaryRegime: 'TRENDING' }) },
      marketData as never,
      { contextual: vi.fn().mockResolvedValue(undefined), decision: vi.fn().mockResolvedValue(undefined), repeatedFailure: vi.fn().mockResolvedValue(undefined), blockedOpportunity: vi.fn().mockResolvedValue(undefined) } as never,
      { recordStageTelemetry: vi.fn() } as never,
      liveTrading as never,
      redis as never,
      decisionJudge,
      undefined,
      quant as never,
    );

    await service.run({
      pipelineId: 'FULL_ANALYSIS_DECISION', runId: 'dislocation-run', userId: 'user-1',
      provider: 'OKX_FUTURES', symbol: 'SOL-USDT', trigger: 'EVENT', createdAt: now.toISOString(),
      params: {
        interval: '15m', strategyIds: ['ai-core'],
        eventScan: {
          fingerprint: 'sol-5m-bullish', direction: 'BULLISH', price: 100.4, atr: 0.8,
          rsi: 58, candleOpenTime: new Date(now.getTime() - 5 * 60_000).toISOString(),
          indicatorCloseTime: now.toISOString(), confirmationCount: 2,
          reasons: ['ROLLING_HIGH_BREAKOUT', 'BULLISH_ATR_IMPULSE'],
        },
      },
    } as never);

    expect(liveTrading.assessPipelineDecision).toHaveBeenCalledWith(expect.objectContaining({
      pipelineRunId: 'dislocation-run',
      executionSizeFactor: 0.1,
    }));
    expect(liveTrading.executePipeline).toHaveBeenCalledWith('user-1', 'dislocation-run');
    expect(redis.setNx).toHaveBeenNthCalledWith(
      2,
      'pipeline:dislocation-canary:cooldown:user-1:SOL-USDT:LONG',
      'dislocation-run',
      60 * 60,
    );
    expect(repository.updateRun).toHaveBeenCalledWith('dislocation-run', expect.objectContaining({
      decision: 'LONG',
      skippedReason: null,
    }));

    liveTrading.assessPipelineDecision.mockClear();
    liveTrading.executePipeline.mockClear();
    redis.setNx.mockImplementation((key: string) =>
      Promise.resolve(!key.includes('pipeline:dislocation-canary:cooldown:')),
    );

    await service.run({
      pipelineId: 'FULL_ANALYSIS_DECISION', runId: 'dislocation-cooldown-run', userId: 'user-1',
      provider: 'OKX_FUTURES', symbol: 'SOL-USDT', trigger: 'EVENT', createdAt: now.toISOString(),
      params: {
        interval: '15m', strategyIds: ['ai-core'],
        eventScan: {
          fingerprint: 'sol-next-5m-bullish', direction: 'BULLISH', price: 100.6, atr: 0.8,
          rsi: 59, candleOpenTime: new Date(now.getTime() - 5 * 60_000).toISOString(),
          indicatorCloseTime: now.toISOString(), confirmationCount: 2,
          reasons: ['ROLLING_HIGH_BREAKOUT', 'BULLISH_ATR_IMPULSE'],
        },
      },
    } as never);

    expect(liveTrading.assessPipelineDecision).not.toHaveBeenCalled();
    expect(liveTrading.executePipeline).not.toHaveBeenCalled();
    expect(repository.updateRun).toHaveBeenCalledWith('dislocation-cooldown-run', expect.objectContaining({
      decision: 'WAIT',
      skippedReason: 'DISLOCATION_CANARY_COOLDOWN_ACTIVE',
    }));

    liveTrading.assessPipelineDecision.mockClear();
    liveTrading.executePipeline.mockClear();
    redis.setNx.mockReset().mockResolvedValue(true);
    signalFilter.evaluate.mockReturnValue({ actionable: true, decision: 'LONG' });
    decisionJudge.evaluate.mockReturnValue({ verdict: 'APPROVE', approved: true, reasons: [] });

    await service.run({
      pipelineId: 'FULL_ANALYSIS_DECISION', runId: 'quant-only-dislocation-run', userId: 'user-1',
      provider: 'OKX_FUTURES', symbol: 'XRP-USDT', trigger: 'EVENT', createdAt: now.toISOString(),
      params: {
        interval: '15m', strategyIds: ['ai-core'],
        eventScan: {
          fingerprint: 'xrp-5m-bullish', direction: 'BULLISH', price: 100.7, atr: 0.8,
          rsi: 58, candleOpenTime: new Date(now.getTime() - 5 * 60_000).toISOString(),
          indicatorCloseTime: now.toISOString(), confirmationCount: 2,
          reasons: ['ROLLING_HIGH_BREAKOUT', 'BULLISH_ATR_IMPULSE'],
        },
      },
    } as never);

    expect(redis.setNx).toHaveBeenNthCalledWith(
      2,
      'pipeline:dislocation-canary:cooldown:user-1:XRP-USDT:LONG',
      'quant-only-dislocation-run',
      60 * 60,
    );
    expect(liveTrading.assessPipelineDecision).toHaveBeenCalledWith(expect.objectContaining({
      pipelineRunId: 'quant-only-dislocation-run',
      executionSizeFactor: 0.1,
    }));

    liveTrading.assessPipelineDecision.mockClear();
    liveTrading.executePipeline.mockClear();
    redis.setNx.mockReset().mockResolvedValue(true);
    signalFilter.evaluate.mockReturnValue({ actionable: false, decision: 'WAIT' });

    await service.run({
      pipelineId: 'FULL_ANALYSIS_DECISION', runId: 'unexplained-filter-rejection-run', userId: 'user-1',
      provider: 'OKX_FUTURES', symbol: 'BTC-USDT', trigger: 'EVENT', createdAt: now.toISOString(),
      params: {
        interval: '15m', strategyIds: ['ai-core'],
        eventScan: {
          fingerprint: 'btc-5m-bullish', direction: 'BULLISH', price: 100.7, atr: 0.8,
          rsi: 58, candleOpenTime: new Date(now.getTime() - 5 * 60_000).toISOString(),
          indicatorCloseTime: now.toISOString(), confirmationCount: 2,
          reasons: ['ROLLING_HIGH_BREAKOUT', 'BULLISH_ATR_IMPULSE'],
        },
      },
    } as never);

    expect(liveTrading.assessPipelineDecision).not.toHaveBeenCalled();
    expect(liveTrading.executePipeline).not.toHaveBeenCalled();
  });

  it('uses BullMQ-safe pipeline queue names', () => {
    expect([PIPELINE_RUN_QUEUE_NAME, PIPELINE_RETRY_QUEUE_NAME, PIPELINE_DEAD_LETTER_QUEUE_NAME]).toEqual([
      'pipeline-run',
      'pipeline-retry',
      'pipeline-dead-letter',
    ]);
    expect([PIPELINE_RUN_QUEUE_NAME, PIPELINE_RETRY_QUEUE_NAME, PIPELINE_DEAD_LETTER_QUEUE_NAME].every((name) => !name.includes(':'))).toBe(true);
  });

  it('does not stamp a schedule as triggered when every enqueue attempt fails', async () => {
    const prisma = {
      pipelineSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'schedule-1',
            userId: 'user-1',
            pipelineId: 'FULL_ANALYSIS_DECISION',
            symbols: ['BTC-USDT'],
            strategyIds: ['ai-core'],
            provider: 'BINANCE_FUTURES',
            mode: 'INTERVAL',
            intervalMs: 300_000,
            lastTriggeredAt: undefined,
            timezone: 'UTC',
            maxRunsPerHour: 12,
          },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const pipeline = {
      trigger: vi.fn().mockRejectedValue(new Error('queue down')),
    };
    const service = new PipelineSchedulerService(prisma as never, pipeline as never, { enabled: true } as never);

    await service.tick(new Date('2026-08-03T09:30:00Z'));

    expect(pipeline.trigger).toHaveBeenCalledTimes(1);
    expect(prisma.pipelineSchedule.update).not.toHaveBeenCalled();
  });

  it('triggers an EVENT run between 15m anchors only after the lightweight scanner confirms it', async () => {
    const prisma = {
      pipelineSchedule: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'schedule-zro',
          userId: 'user-1',
          pipelineId: 'FULL_ANALYSIS_DECISION',
          symbols: ['ZRO-USDT'],
          strategyIds: ['trend', 'breakout'],
          provider: 'OKX_FUTURES',
          mode: 'INTERVAL',
          intervalMs: 900_000,
          lastTriggeredAt: new Date('2026-08-19T01:10:00Z'),
          timezone: 'UTC',
          maxRunsPerHour: 60,
        }]),
        update: vi.fn(),
      },
    };
    const pipeline = { trigger: vi.fn().mockResolvedValue({ id: 'event-run' }) };
    const eventScanner = {
      scan: vi.fn().mockResolvedValue({
        triggered: true,
        reason: 'EVENT_CONFIRMED',
        fingerprint: 'zro-5m-bullish',
        evidence: {
          direction: 'BULLISH',
          price: 0.7947,
          atr: 0.005,
          rsi: 68.06,
          candleOpenTime: '2026-08-19T01:14:00.000Z',
          indicatorCloseTime: '2026-08-19T01:14:59.999Z',
          reasons: ['BULLISH_ATR_IMPULSE'],
          confirmationCount: 2,
        },
      }),
    };
    const service = new PipelineSchedulerService(
      prisma as never,
      pipeline as never,
      { enabled: true } as never,
      undefined,
      eventScanner as never,
    );

    await service.tick(new Date('2026-08-19T01:15:00Z'));

    expect(eventScanner.scan).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'ZRO-USDT',
      strategyIds: ['trend', 'breakout'],
    }));
    expect(pipeline.trigger).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        symbol: 'ZRO-USDT',
        params: expect.objectContaining({
          interval: '15m',
          eventScan: expect.objectContaining({ fingerprint: 'zro-5m-bullish' }) as unknown,
        }) as unknown,
      }),
      'EVENT',
      { scheduleId: 'schedule-zro', maxRunsPerHour: 60 },
    );
    expect(prisma.pipelineSchedule.update).not.toHaveBeenCalled();
  });

  it('stamps but does not enqueue a due anchor when its closed-candle fingerprint is unchanged', async () => {
    const schedule = {
      id: 'schedule-zro', userId: 'user-1', pipelineId: 'FULL_ANALYSIS_DECISION',
      symbols: ['ZRO-USDT'], strategyIds: ['trend'], provider: 'OKX_FUTURES',
      mode: 'INTERVAL', intervalMs: 900_000, lastTriggeredAt: undefined,
      timezone: 'UTC', maxRunsPerHour: 60,
    };
    const prisma = {
      pipelineSchedule: {
        findMany: vi.fn().mockResolvedValue([schedule]),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const pipeline = { trigger: vi.fn() };
    const eventScanner = {
      reserveAnchor: vi.fn().mockResolvedValue({ run: false, fingerprint: 'same-15m-candle' }),
    };
    const service = new PipelineSchedulerService(
      prisma as never,
      pipeline as never,
      { enabled: true } as never,
      undefined,
      eventScanner as never,
    );

    const now = new Date('2026-08-19T01:15:00Z');
    await service.tick(now);

    expect(pipeline.trigger).not.toHaveBeenCalled();
    expect(prisma.pipelineSchedule.update).toHaveBeenCalledWith({
      where: { id: 'schedule-zro' },
      data: { lastTriggeredAt: now },
    });
  });

  it('marks a schedule as triggered when at least one dispatch succeeds', async () => {
    let lastTriggeredAt: Date | undefined;
    const prisma = {
      pipelineSchedule: {
        findMany: vi.fn().mockImplementation(() => [
          {
            id: 'schedule-1',
            userId: 'user-1',
            pipelineId: 'FULL_ANALYSIS_DECISION',
            symbols: ['BTC-USDT', 'ETH-USDT'],
            strategyIds: ['ai-core', 'trend'],
            provider: 'BINANCE_FUTURES',
            mode: 'INTERVAL',
            intervalMs: 300_000,
            lastTriggeredAt,
            timezone: 'UTC',
            maxRunsPerHour: 12,
          },
        ]),
        update: vi.fn().mockImplementation(({ data }: { data: { lastTriggeredAt: Date } }) => {
          lastTriggeredAt = data.lastTriggeredAt;
          return {};
        }),
      },
    };
    const triggerMock = vi.fn().mockImplementation(() => {
      const callCount = triggerMock.mock.calls.length;
      if (callCount === 2) return Promise.resolve({});
      return Promise.reject(new Error('queue down'));
    });
    const pipeline = {
      trigger: triggerMock,
    };
    const service = new PipelineSchedulerService(prisma as never, pipeline as never, { enabled: true } as never);

    await service.tick(new Date('2026-08-03T09:30:00Z'));
    await service.tick(new Date('2026-08-03T09:30:05Z'));

    expect(pipeline.trigger).toHaveBeenCalledTimes(2);
    expect(triggerMock).toHaveBeenNthCalledWith(
      1,
      'user-1',
      expect.objectContaining({
        symbol: 'BTC-USDT',
        params: { strategyIds: ['ai-core', 'trend'] },
      }),
      'SCHEDULE',
      expect.objectContaining({ scheduleId: 'schedule-1' }),
    );
    expect(prisma.pipelineSchedule.update).toHaveBeenCalledTimes(1);
  });

  it('does not enqueue a user schedule when its exchange connection is no longer eligible', async () => {
    const prisma = {
      exchangeConnection: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      pipelineSchedule: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'schedule-connection',
          userId: 'user-1',
          pipelineId: 'FULL_ANALYSIS_DECISION',
          symbols: ['BTC-USDT'],
          strategyIds: ['trend'],
          provider: 'OKX_FUTURES',
          mode: 'INTERVAL',
          intervalMs: 300_000,
          lastTriggeredAt: undefined,
          timezone: 'UTC',
          maxRunsPerHour: 12,
        }]),
        update: vi.fn(),
      },
    };
    const pipeline = { trigger: vi.fn() };
    const service = new PipelineSchedulerService(
      prisma as never,
      pipeline as never,
      { enabled: true } as never,
    );

    await service.tick(new Date('2026-08-24T03:00:00Z'));

    expect(prisma.exchangeConnection.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        provider: 'OKX_FUTURES',
        isEnabled: true,
        isVerified: true,
      },
      select: { id: true },
    });
    expect(pipeline.trigger).not.toHaveBeenCalled();
    expect(prisma.pipelineSchedule.update).not.toHaveBeenCalled();
  });

  it('accepts a scheduled symbol independently of legacy portfolio strategy symbols', async () => {
    const prisma = {
      exchangeConnection: { findFirst: vi.fn().mockResolvedValue({ id: 'connection-1' }) },
      portfolioStrategy: { findMany: vi.fn().mockResolvedValue([{ key: 'trend' }]) },
      pipelineSchedule: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve(data)),
      },
    };
    const service = new PipelineSchedulerService(
      prisma as never,
      {} as never,
      { enabled: true } as never,
    );

    const created = await service.create('user-1', {
      pipelineId: 'FULL_ANALYSIS_DECISION',
      symbols: ['SOL-USDT'],
      strategyIds: ['trend'],
      provider: 'OKX_FUTURES',
      mode: 'INTERVAL',
      intervalMs: 900_000,
      enabled: true,
      timezone: 'Asia/Saigon',
      maxRunsPerHour: 12,
    });

    expect(prisma.portfolioStrategy.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        key: { in: ['trend'] },
        status: 'ACTIVE',
      },
      select: { key: true },
    });
    expect(created).toEqual(expect.objectContaining({ symbols: ['SOL-USDT'] }));
  });

  it('registers selected strategies for a new account before validating a schedule', async () => {
    let registered = false;
    const prisma = {
      exchangeConnection: { findFirst: vi.fn().mockResolvedValue({ id: 'connection-1' }) },
      portfolioStrategy: {
        findMany: vi.fn().mockImplementation(() =>
          registered ? [{ key: 'momentum-scalp' }] : [],
        ),
      },
      pipelineSchedule: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve(data)),
      },
    };
    const portfolio = {
      ensureRegisteredStrategies: vi.fn().mockImplementation(() => {
        registered = true;
        return Promise.resolve();
      }),
    };
    const service = new PipelineSchedulerService(
      prisma as never,
      {} as never,
      { enabled: true } as never,
      undefined,
      undefined,
      portfolio as never,
    );

    await expect(service.create('user-1', {
      pipelineId: 'FULL_ANALYSIS_DECISION',
      symbols: ['SOL-USDT'],
      strategyIds: ['momentum-scalp'],
      provider: 'OKX_FUTURES',
      mode: 'INTERVAL',
      intervalMs: 900_000,
      enabled: true,
      timezone: 'Asia/Saigon',
      maxRunsPerHour: 12,
    })).resolves.toEqual(expect.objectContaining({ strategyIds: ['momentum-scalp'] }));

    expect(portfolio.ensureRegisteredStrategies).toHaveBeenCalledWith(
      'user-1',
      ['momentum-scalp'],
      ['SOL-USDT'],
    );
  });
});

describe("drift reassessment boundary", () => {
  it("reassesses at most once when pipeline execution drifts", async () => {
    const assessPipelineDecision = vi.fn().mockResolvedValue({ outcome: "RISK_APPROVED", price: 100 });
    const executePipeline = vi.fn()
      .mockResolvedValueOnce({ outcome: "EXECUTION_FAILED", errorCode: "ENTRY_PRICE_DRIFT", retryable: true })
      .mockResolvedValueOnce({ outcome: "ORDER_SUBMITTED" });

    const { executeWithSingleDriftReassessment } = await import(
      "../../src/modules/pipeline/application/entry-drift-reassessment"
    );

    const result = await executeWithSingleDriftReassessment({
      assess: async () => {
        await assessPipelineDecision();
      },
      execute: async () => {
        const res = (await executePipeline()) as { outcome: string; errorCode?: string };
        return res;
      },
    });

    expect(result.outcome).toBe("ORDER_SUBMITTED");
    expect(assessPipelineDecision).toHaveBeenCalledTimes(2);
    expect(executePipeline).toHaveBeenCalledTimes(2);
  });

  it("returns terminal result after second drift without further retry", async () => {
    const assessPipelineDecision = vi.fn().mockResolvedValue({ outcome: "RISK_APPROVED", price: 100 });
    const executePipeline = vi.fn().mockResolvedValue(
      { outcome: "EXECUTION_FAILED", errorCode: "ENTRY_PRICE_DRIFT", retryable: true },
    );

    const { executeWithSingleDriftReassessment } = await import(
      "../../src/modules/pipeline/application/entry-drift-reassessment"
    );

    const result = await executeWithSingleDriftReassessment({
      assess: async () => {
        await assessPipelineDecision();
      },
      execute: async () => {
        const res = (await executePipeline()) as { outcome: string; errorCode?: string };
        return res;
      },
    });

    expect(result.outcome).toBe("EXECUTION_FAILED");
    expect(assessPipelineDecision).toHaveBeenCalledTimes(2);
    expect(executePipeline).toHaveBeenCalledTimes(2);
  });

  it("degrades gracefully without blocking pipeline when an optional secondary timeframe is stale but primary timeframe is fresh", async () => {
    const freshCloseTime = new Date();
    const staleCloseTime = new Date(Date.now() - 3600_000); // 1 hour ago (stale for 5m)

    const fusionResult = {
      analyses: {
        market: {
          trend: { direction: 'UP', strength: 'STRONG' },
          volatility: { atr: 10 },
          liquidity: { spread: '0.01%' },
          dataQuality: 'GOOD',
          summary: 'Market is strongly bullish',
        },
        technical: {
          trend: { direction: 'UP', strength: 'STRONG' },
          movingAverages: { alignment: 'BULLISH' },
          momentum: { rsi: '60.00', macd: { trend: 'BULLISH' } },
          structure: { breakout: false, marketStructure: 'HH_HL' },
          dataQuality: 'GOOD',
          summary: 'Technicals are aligned bullish',
        },
        news: { impact: { level: 'LOW' }, dataQuality: 'GOOD', summary: 'Neutral' },
        sentiment: { sentiment: { overall: 'NEUTRAL' }, dataQuality: 'GOOD', summary: 'Neutral' },
        macro: { macroTrend: 'NEUTRAL', dataQuality: 'GOOD', summary: 'Neutral' },
        onchain: { activity: 'NORMAL', signals: [], dataQuality: 'GOOD', summary: 'Neutral' },
      },
      fusionOutput: {
        overallBias: 'BULLISH',
        confidence: 80,
        dataQuality: 'GOOD',
        summary: 'Bullish confluence',
      },
    };

    const fusion = { runDetailed: vi.fn().mockResolvedValue(fusionResult) };
    const decisionOutput = {
      decision: 'LONG',
      confidence: 80,
      reasoning: 'strong trend',
      signals: { bullishFactors: ['trend'], bearishFactors: [] },
      risks: [],
      dataQuality: 'GOOD',
      coreDataQuality: 'GOOD',
      conflictLevel: 'LOW',
      opportunityScore: 85,
      expectedWinProbability: 0.7,
      expectedReward: 2.0,
      expectedLoss: 0.8,
      expectedValue: 1.2,
      profitFactorEstimate: 2.5,
      riskScore: 20,
      adaptiveThreshold: 60,
      volatilityAdjustment: 0,
      directionalAgreement: 100,
      evidenceCoverage: 100,
      agreementScore: 80,
      regime: { type: 'TRENDING' },
      weighting: { market: 20, technical: 25, news: 15, sentiment: 15, macro: 15, onchain: 10 },
      overrides: [],
      calibrationAdjustment: 0,
      executionCost: 0.04,
      executionContext: {
        regime: 'TRENDING', setup: 'TREND_PULLBACK', action: 'ENTER', riskTier: 'NORMAL',
        sourceDataCutoff: freshCloseTime.toISOString(), usesClosedPrimaryCandle: true,
        triggerConfirmed: true, priceLocation: {},
      },
      generatedAt: new Date().toISOString(),
    };

    const decision = {
      decideForUser: vi.fn().mockResolvedValue(decisionOutput),
      decideWithReflection: vi.fn().mockResolvedValue(decisionOutput),
      calibrateForExecution: vi.fn().mockImplementation((val: unknown) => Promise.resolve(val)),
    };
    const repository = {
      updateRun: vi.fn().mockResolvedValue({}),
      updateStep: vi.fn().mockResolvedValue({}),
      activeStrategyKeys: vi.fn().mockResolvedValue(['trend']),
    };
    const riskPolicy = {
      evaluate: vi.fn().mockReturnValue({ actionable: true, decision: 'LONG' }),
    };
    const signalFilter = { evaluate: vi.fn().mockReturnValue({ allowed: true }) };
    const marketData = {
      // Primary 15m is fresh; optional 5m is stale
      getIndicatorSnapshot: vi.fn().mockImplementation((_p, _s, interval) => {
        if (interval === '5m') {
          return Promise.resolve({ candleCloseTime: staleCloseTime, values: { rsi14: 50, ema20: 100, ema50: 99 } });
        }
        return Promise.resolve({ candleCloseTime: freshCloseTime, values: { rsi14: 60, atr14: 10, ema20: 100, ema50: 98, ema200: 90 } });
      }),
      getHistoricalCandles: vi.fn().mockImplementation(({ interval }) => {
        if (interval === '5m') {
          return Promise.resolve([{ close: '100', closeTime: staleCloseTime }]);
        }
        return Promise.resolve([{ close: '105', closeTime: freshCloseTime }]);
      }),
    };
    const alerts = {
      decision: vi.fn().mockResolvedValue(undefined),
      contextual: vi.fn().mockResolvedValue(undefined),
      repeatedFailure: vi.fn().mockResolvedValue(undefined),
      blockedOpportunity: vi.fn().mockResolvedValue(undefined),
    };
    const analytics = { recordStageTelemetry: vi.fn() };
    const liveTrading = {
      assessPipelineDecision: vi.fn().mockResolvedValue({ outcome: 'RISK_APPROVED', risk: { approved: true, reason: 'ok', riskScore: 20 } }),
      executePipeline: vi.fn().mockResolvedValue({ outcome: 'ORDER_SUBMITTED' }),
    };
    const redis = {
      setNx: vi.fn().mockResolvedValue(true),
      compareAndDelete: vi.fn().mockResolvedValue(true),
    };

    const service = new PipelineRunnerService(
      fusion as never,
      decision as never,
      repository as never,
      { isCancelled: vi.fn().mockResolvedValue(false) } as never,
      riskPolicy,
      signalFilter,
      marketData as never,
      alerts as never,
      analytics as never,
      liveTrading as never,
      redis as never,
      undefined,
      undefined,
      { evaluate: vi.fn().mockResolvedValue({ allowed: true, evaluated: true }) } as never,
    );

    await service.run({
      pipelineId: 'FULL_ANALYSIS_DECISION',
      runId: 'graceful-degrade-run',
      userId: 'user-1',
      provider: 'OKX_FUTURES',
      symbol: 'BTC-USDT',
      params: { interval: '15m', strategyIds: ['trend'] },
      trigger: 'EVENT',
    } as never);

    // Assert that the pipeline was NOT rejected with STALE_MARKET_DATA and proceeded to execute
    expect(repository.updateRun).toHaveBeenCalledWith(
      'graceful-degrade-run',
      expect.objectContaining({
        status: 'COMPLETED',
        decision: 'LONG',
        skippedReason: null,
      }),
    );
    expect(liveTrading.assessPipelineDecision).toHaveBeenCalled();
  });
});
