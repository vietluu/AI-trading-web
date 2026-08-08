import { describe, expect, it, vi } from 'vitest';
import { cronMatches, validateCron } from '../../src/modules/pipeline/domain/cron';
import { pipelineSkipReason } from '../../src/modules/pipeline/domain/rate-limit';
import { FULL_ANALYSIS_DECISION } from '../../src/modules/pipeline/domain/pipeline.definition';
import { PipelineThresholdService } from '../../src/modules/pipeline/application/pipeline-threshold.service';
import { PipelineSchedulerService } from '../../src/modules/pipeline/application/pipeline-scheduler.service';
import { PipelineRunnerService } from '../../src/modules/pipeline/application/pipeline-runner.service';
import { PIPELINE_DEAD_LETTER_QUEUE_NAME, PIPELINE_RETRY_QUEUE_NAME, PIPELINE_RUN_QUEUE_NAME } from '../../src/modules/pipeline/infrastructure/pipeline-queue.constants';

describe('Phase 6.6 pipeline runtime policies', () => {
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
    const service = new PipelineThresholdService({ minConfidence: 70 } as never);
    const output = {
      decision: 'LONG',
      confidence: 60,
      dataQuality: 'GOOD',
      conflictLevel: 'LOW',
      opportunityScore: 74,
      expectedValue: 0.12,
      riskScore: 45,
      adaptiveThreshold: 62,
    };
    expect(service.evaluate(output as never)).toEqual({ actionable: true });
    expect(service.evaluate({ ...output, confidence: 55 } as never)).toEqual({ actionable: false, reason: 'CONFIDENCE_BELOW_THRESHOLD' });
    expect(service.evaluate({ ...output, expectedValue: -0.05 } as never)).toEqual({ actionable: false, reason: 'EXPECTED_VALUE_NEGATIVE' });
    expect(service.evaluate({ ...output, opportunityScore: 58 } as never)).toEqual({ actionable: false, reason: 'OPPORTUNITY_BELOW_THRESHOLD' });
    expect(service.evaluate({ ...output, dataQuality: 'INSUFFICIENT' } as never)).toEqual({ actionable: false, reason: 'DATA_QUALITY_INSUFFICIENT' });
    expect(service.evaluate({ ...output, conflictLevel: 'HIGH' } as never)).toEqual({ actionable: false, reason: 'HIGH_CONFLICT' });
  });

  it('uses bounded exponential retry settings for safe research jobs', () => {
    expect(FULL_ANALYSIS_DECISION.retryPolicy).toEqual({ attempts: 2, backoffMs: 5000 });
    expect(FULL_ANALYSIS_DECISION.steps.at(-1)?.type).toBe('DECISION');
  });

  it('skips live assessment and execution when the decision gate blocks the trade', async () => {
    const repository = {
      updateRun: vi.fn().mockResolvedValue({}),
      updateStep: vi.fn().mockResolvedValue({}),
      findRun: vi.fn().mockResolvedValue(undefined),
    };
    const fusion = {
      runDetailed: vi.fn().mockResolvedValue({
        analyses: {
          market: { summary: 'market', trend: { direction: 'UP', strength: 'STRONG' }, volatility: { level: 'MEDIUM' }, liquidity: {}, derivatives: {}, anomalies: [], dataQuality: 'GOOD', usedTools: [], generatedAt: new Date().toISOString() },
          technical: { summary: 'tech', trend: { direction: 'UP', strength: 'STRONG' }, momentum: { rsi: '58', rsiState: 'NEUTRAL', macd: { trend: 'BULLISH' } }, movingAverages: { alignment: 'BULLISH', pricePosition: 'ABOVE' }, volatility: { bollinger: { position: 'MIDDLE', squeeze: false } }, structure: { marketStructure: 'HH_HL' }, divergence: {}, signals: [], dataQuality: 'GOOD', usedTools: [], generatedAt: new Date().toISOString() },
          news: { summary: 'news', impact: { level: 'LOW', direction: 'NEUTRAL' }, keyEvents: [], themes: [], riskSignals: [], dataQuality: 'GOOD', usedTools: [], generatedAt: new Date().toISOString() },
          sentiment: { summary: 'sentiment', sentiment: { overall: 'BULLISH', intensity: 'MEDIUM' }, crowdBehavior: { fomo: false, panic: false, euphoria: false }, sources: {}, anomalies: [], dataQuality: 'GOOD', usedTools: [], generatedAt: new Date().toISOString() },
          macro: { summary: 'macro', macroTrend: 'RISK_ON', keyEvents: [], riskFactors: [], dataQuality: 'GOOD', generatedAt: new Date().toISOString() },
          onchain: { summary: 'onchain', activity: 'HIGH', flows: { exchangeInflow: 'rising' }, signals: [], dataQuality: 'GOOD', generatedAt: new Date().toISOString() },
        },
        fusionOutput: {
          summary: 'fusion', combinedAnalysis: {}, overallBias: 'BULLISH', confidence: 70, conflicts: [], dataQuality: 'GOOD', generatedAt: new Date().toISOString(),
        },
      }),
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
    };
    const threshold = { evaluate: vi.fn().mockReturnValue({ actionable: false, reason: 'CONFIDENCE_BELOW_THRESHOLD' }) };
    const riskPolicy = { evaluate: vi.fn().mockReturnValue({ actionable: false, decision: 'WAIT', reason: 'CONFIDENCE_BELOW_THRESHOLD' }) };
    const signalFilter = { evaluate: vi.fn().mockReturnValue({ allowed: true, reason: undefined }) };
    const marketData = {
      getIndicatorSnapshot: vi.fn().mockResolvedValue({ values: { rsi14: 55, atr14: 0.8, volumeChangePercent: 3, ema20: 100, ema50: 99, ema200: 95 } }),
      getHistoricalCandles: vi.fn().mockResolvedValue([{ close: '100' }]),
    };
    const alerts = { contextual: vi.fn().mockResolvedValue(undefined), decision: vi.fn().mockResolvedValue(undefined), repeatedFailure: vi.fn().mockResolvedValue(undefined) };
    const analytics = { recordStageTelemetry: vi.fn() };
    const liveTrading = {
      assessPipelineDecision: vi.fn().mockResolvedValue({ risk: { approved: true, reason: 'ok', riskScore: 20 } }),
      executePipeline: vi.fn().mockResolvedValue({ outcome: 'EXECUTED' }),
    };
    const service = new PipelineRunnerService(
      fusion as never,
      decision as never,
      repository as never,
      { isCancelled: vi.fn().mockResolvedValue(false) } as never,
      threshold as never,
      riskPolicy,
      signalFilter,
      marketData as never,
      alerts as never,
      analytics as never,
      liveTrading as never,
      { setNx: vi.fn().mockResolvedValue(true), delete: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await service.run({
      pipelineId: 'FULL_ANALYSIS_DECISION',
      runId: 'run-1',
      userId: 'user-1',
      provider: 'BINANCE_FUTURES',
      symbol: 'BTC-USDT',
      params: { interval: '1h' },
      trigger: 'EVENT',
    } as never);

    expect(liveTrading.assessPipelineDecision).not.toHaveBeenCalled();
    expect(liveTrading.executePipeline).not.toHaveBeenCalled();
    expect(repository.updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'COMPLETED', decision: 'WAIT' }));
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
      if (callCount === 3) return Promise.resolve({});
      return Promise.reject(new Error('queue down'));
    });
    const pipeline = {
      trigger: triggerMock,
    };
    const service = new PipelineSchedulerService(prisma as never, pipeline as never, { enabled: true } as never);

    await service.tick(new Date('2026-08-03T09:30:00Z'));
    await service.tick(new Date('2026-08-03T09:30:05Z'));

    expect(pipeline.trigger).toHaveBeenCalledTimes(4);
    expect(prisma.pipelineSchedule.update).toHaveBeenCalledTimes(1);
  });
});
