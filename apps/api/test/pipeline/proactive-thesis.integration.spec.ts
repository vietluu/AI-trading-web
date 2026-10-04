/**
 * Integration tests for the proactive-thesis pipeline flow.
 *
 * These tests invoke PipelineRunnerService.run() with fully mocked
 * dependencies and assert that the full proactive AI execution path
 * (researcher -> critic -> risk -> submission) behaves correctly.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PipelineRunnerService } from "../../src/modules/pipeline/application/pipeline-runner.service";
import type { LiveTradingService } from "../../src/modules/live-trading/application/live-trading.service";
import type { TradeResearcherService } from "../../src/modules/agents/application/services/trade-researcher.service";
import type { ChainOfThoughtReflectionService } from "../../src/modules/agents/application/services/chain-of-thought-reflection.service";
import type { AnticipatorySnapshotService } from "../../src/modules/agents/application/services/anticipatory-snapshot.service";
import type { QuantExecutionPolicyService } from "../../src/modules/pipeline/application/quant-execution-policy.service";
import type { SelfLearningService } from "../../src/modules/reflection/application/self-learning.service";
import { DecisionRiskPolicyService } from "../../src/modules/risk/application/decision-risk-policy.service";
import { DecisionJudgeService } from "../../src/modules/pipeline/application/decision-judge.service";

import type { FusionService } from "../../src/modules/agents/application/services/fusion.service";
import type { DecisionService } from "../../src/modules/agents/application/services/decision.service";
import type { PipelineRepository } from "../../src/modules/pipeline/infrastructure/pipeline.repository";
import type { ProactiveLifecycleRepository } from "../../src/modules/pipeline/infrastructure/proactive-lifecycle.repository";
import type { PipelineCancellationService } from "../../src/modules/pipeline/infrastructure/pipeline-cancellation.service";
import type { PipelineAlertService } from "../../src/modules/pipeline/application/pipeline-alert.service";
import type { PipelineAnalyticsService } from "../../src/modules/pipeline/application/pipeline-analytics.service";
import type { PortfolioService } from "../../src/modules/portfolio/application/portfolio.service";
import type { ConfluenceCollectorService } from "../../src/modules/pipeline/infrastructure/confluence-collector.service";
import type { PipelineJob } from "../../src/modules/pipeline/infrastructure/pipeline-queue.service";
import type { MarketDataService } from "../../src/market-data/application/market-data.service";
import type { SettingsService } from "../../src/settings/settings.service";
import type { RedisService } from "../../src/redis/redis.service";
import type { DecisionOutput, FusionInput } from "@platform/shared";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SYMBOL = "BTC-USDT";
const PRICE = 108_200;
import {
  cutoff,
  createBaseSnapshot,
  createValidLongThesis,
} from "../helpers/thesis-fixture";

const makeJob = (): PipelineJob => ({
  runId: "run-1",
  pipelineId: "proactive-thesis",
  userId: "user-1",
  provider: "BINANCE_FUTURES",
  symbol: SYMBOL,
  params: {
    interval: "15m",
    lookbackCandles: 150,
    opportunityId: "opportunity-1",
    snapshotId: "snapshot-1",
    sourceDataCutoff: cutoff,
  },
  trigger: "SCHEDULE",
  createdAt: new Date().toISOString(),
});

const makeFusionResult = () => ({
  analyses: {
    market: {
      volatility: { atr: 800 },
      impact: { level: "LOW", direction: "NEUTRAL" },
    },
    technical: { structure: { breakout: false, marketStructure: "HH_HL" } },
    news: { impact: { level: "LOW", direction: "NEUTRAL" } },
    sentiment: {},
    macro: {},
    onchain: {},
  },
  fusionOutput: {
    decision: "LONG",
    confidence: 80,
    regime: { type: "TRENDING_BULL" },
    opportunityScore: 75,
    riskScore: 30,
    expectedReward: 3,
    expectedLoss: 1,
    expectedValue: 2,
    conflictLevel: "LOW",
    dataQuality: "GOOD",
    reasoning: "strong structure",
    signals: { bullishFactors: [], bearishFactors: [] },
    generatedAt: new Date().toISOString(),
    agreementScore: 90,
    risks: [],
    weighting: {
      technical: 0.5,
      market: 0.5,
      news: 0,
      sentiment: 0,
      macro: 0,
      onchain: 0,
    },
    expectedWinProbability: 0.6,
    volatilityAdjustment: 0,
    overrides: [],
    profitFactorEstimate: 2,
    adaptiveThreshold: 50,
    calibrationAdjustment: 0,
    executionCost: 0,
    executionContext: {
      regime: "RANGING",
      setup: "RANGE_REVERSION",
      action: "ENTER",
      riskTier: "NORMAL",
      sourceDataCutoff: cutoff,
      usesClosedPrimaryCandle: true,
      triggerConfirmed: true,
      priceLocation: { rangePercentile: 0.05 },
    },
  },
  cacheHits: {},
});

const makeSnapshot = () => createBaseSnapshot();

const createValidShortThesis = () => ({
  ...createValidLongThesis(),
  direction: "SHORT" as const,
  entryZone: { lower: 108000, upper: 108500 },
  trigger: [
    {
      type: "PRICE_BELOW" as const,
      price: 108250,
      description: "Break below the range boundary",
    },
  ],
  invalidation: {
    price: 108700,
    reason: "Range resistance reclaim invalidates the short",
  },
  stopLoss: 109000,
  targets: [{ price: 106000, fraction: 1 }],
});

const makeApprovedRiskAssessment = () => ({
  outcome: "RISK_APPROVED" as const,
  price: PRICE,
  risk: {
    approved: true,
    positionSize: 0.1,
    tradePlan: {
      stagedEntry: {
        stage: "PROBE",
        probeSizePct: 0.25,
        confirmationSizePct: 0.75,
        combinedRiskLimitPct: 0.005,
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Proactive Thesis Pipeline Integration", () => {
  let pipelineRunner: PipelineRunnerService;
  let mockLiveTrading: Partial<LiveTradingService>;
  let mockTradeResearcher: Partial<TradeResearcherService>;
  let mockCritic: Partial<ChainOfThoughtReflectionService>;
  let mockSnapshotService: Partial<AnticipatorySnapshotService>;
  let mockQuantPolicy: Partial<QuantExecutionPolicyService>;
  let mockDecision: {
    decideForUser: ReturnType<typeof vi.fn>;
    calibrateForExecution: ReturnType<typeof vi.fn>;
  };
  let mockFusion: { runDetailed: ReturnType<typeof vi.fn> };
  let mockCollector: { addSignal: ReturnType<typeof vi.fn> };
  let mockRunUpdates: ReturnType<typeof vi.fn>;
  let mockExecutionLock: ReturnType<typeof vi.fn>;
  let mockActiveStrategyKeys: ReturnType<typeof vi.fn>;
  let mockSelfLearning: Partial<SelfLearningService>;
  let mockLifecycle: {
    persistThesis: ReturnType<typeof vi.fn>;
    persistReview: ReturnType<typeof vi.fn>;
    persistExecutionPlan: ReturnType<typeof vi.fn>;
  };
  let persistedTheses: unknown[];
  let persistedReviews: unknown[];
  let persistedPlans: unknown[];

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(cutoff));
    vi.stubEnv("PROACTIVE_AI_MODE", "DEMO");

    mockLiveTrading = {
      proactiveExecutionEvidence: vi.fn().mockResolvedValue(undefined),
      executePipeline: vi
        .fn()
        .mockResolvedValue({ outcome: "ORDER_SUBMITTED" }),
      assessPipelineDecision: vi
        .fn()
        .mockResolvedValue(makeApprovedRiskAssessment()),
      hasVerifiedDemoConnection: vi.fn().mockResolvedValue(true),
    };

    mockTradeResearcher = {
      persistReview: vi.fn().mockResolvedValue("review-1"),
      research: vi.fn().mockResolvedValue({
        preferred: {
          ...createValidLongThesis(),
          targets: [{ price: 112000, fraction: 1 }],
        },
        alternatives: [],
        researchRunId: "thesis-1",
        contextSnapshotId: "context-1",
      }),
    };

    mockCritic = {
      reflect: vi
        .fn()
        .mockResolvedValue({
          action: "APPROVE",
          reasonCodes: [],
          evidenceRefs: [],
          rationale: "valid",
        }),
    };

    mockSnapshotService = {
      build: vi.fn().mockResolvedValue(makeSnapshot()),
    };

    mockQuantPolicy = {
      evaluate: vi
        .fn()
        .mockResolvedValue({ severity: "APPROVE", allowed: true, reasons: [] }),
    };
    mockSelfLearning = {
      evaluateProfitAuthorityForThesis: vi.fn().mockResolvedValue({
        action: "FULL_SIZE",
        sizeFactor: 1,
        sampleSize: 30,
        probabilityAuthority: "EXACT_LIFECYCLE",
        empiricalWinProbability: 0.6,
        reason: "stable exact lifecycle",
      }),
      recentLossesForThesis: vi.fn().mockResolvedValue([]),
    };

    const fusionResult = makeFusionResult();
    mockFusion = { runDetailed: vi.fn().mockResolvedValue(fusionResult) };
    mockDecision = {
      decideForUser: vi.fn().mockResolvedValue(fusionResult.fusionOutput),
      calibrateForExecution: vi
        .fn()
        .mockImplementation((d: DecisionOutput) =>
          Promise.resolve({ ...fusionResult.fusionOutput, ...d }),
        ),
    };
    mockCollector = { addSignal: vi.fn().mockResolvedValue({ ready: true }) };
    mockRunUpdates = vi.fn().mockResolvedValue(undefined);
    mockExecutionLock = vi.fn().mockResolvedValue(true);
    mockActiveStrategyKeys = vi.fn().mockResolvedValue(["ai-core"]);
    persistedTheses = [];
    persistedReviews = [];
    persistedPlans = [];
    mockLifecycle = {
      persistThesis: vi.fn().mockImplementation((input) => {
        persistedTheses.push(input);
        return Promise.resolve({
          thesisId: "relational-thesis-1",
          reused: false,
        });
      }),
      persistReview: vi.fn().mockImplementation((input) => {
        persistedReviews.push(input);
        return Promise.resolve({
          reviewId: "relational-review-1",
          reused: false,
        });
      }),
      persistExecutionPlan: vi.fn().mockImplementation((input) => {
        persistedPlans.push(input);
        return Promise.resolve({ planId: "relational-plan-1", reused: false });
      }),
    };

    pipelineRunner = new PipelineRunnerService(
      // fusion
      mockFusion as unknown as FusionService,
      // decision
      mockDecision as unknown as DecisionService,
      // repository
      {
        claimProactiveThesisExecution: vi.fn().mockResolvedValue({ count: 1 }),
        updateStep: vi.fn().mockResolvedValue(undefined),
        updateRun: mockRunUpdates,
        updateJob: vi.fn().mockResolvedValue(undefined),
        markJobFailed: vi.fn().mockResolvedValue(undefined),
        markJobCompleted: vi.fn().mockResolvedValue(undefined),
        activeStrategyKeys: mockActiveStrategyKeys,
        findRun: vi.fn().mockResolvedValue(null),
      } as unknown as PipelineRepository,
      mockLifecycle as unknown as ProactiveLifecycleRepository,
      {
        isCancelled: vi.fn().mockResolvedValue(false),
      } as unknown as PipelineCancellationService, // cancellation
      // riskPolicy — always allow through; actual risk eval happens in assessPipelineDecision
      {
        evaluate: vi
          .fn()
          .mockReturnValue({ actionable: true, reason: undefined }),
      },
      // signalFilter
      {
        evaluate: vi.fn().mockReturnValue({ allowed: true, actionable: true }),
      },
      // marketData
      {
        getLatestPrice: vi.fn().mockResolvedValue(PRICE),
        getIndicatorSnapshot: vi.fn().mockResolvedValue({
          candleCloseTime: new Date().toISOString(),
          values: {
            close: PRICE,
            rsi14: 55,
            atr14: 800,
            ema20: 99_500,
            ema50: 98_000,
            ema200: 95_000,
            priceChangePercent: 2,
            volumeChangePercent: 60,
            adx14: 28,
            efficiencyRatio20: 0.45,
            rollingLow: 97_000,
            rollingHigh: 103_000,
          },
        }),
        getMarketData: vi.fn().mockResolvedValue({
          "15m": {
            snapshot: { timestamp: new Date().toISOString() },
            indicators: {},
          },
        }),
        getHistoricalCandles: vi.fn().mockResolvedValue([
          {
            closeTime: new Date().toISOString(),
            close: PRICE,
            open: PRICE - 200,
            high: PRICE + 300,
            low: PRICE - 400,
          },
        ]),
      } as unknown as MarketDataService,
      // alerts
      {
        repeatedFailure: vi.fn().mockResolvedValue(undefined),
        executionStalled: vi.fn().mockResolvedValue(undefined),
        contextual: vi.fn().mockResolvedValue(undefined),
        blockedOpportunity: vi.fn().mockResolvedValue(undefined),
        decision: vi.fn().mockResolvedValue(undefined),
        confluenceEvaluation: vi.fn().mockResolvedValue(undefined),
      } as unknown as PipelineAlertService,
      { recordStageTelemetry: vi.fn() } as unknown as PipelineAnalyticsService, // analytics
      mockLiveTrading as unknown as LiveTradingService,
      // redis
      {
        setNx: mockExecutionLock,
        compareAndDelete: vi.fn().mockResolvedValue(undefined),
      } as unknown as RedisService,
      // judge
      {
        evaluate: vi
          .fn()
          .mockReturnValue({
            verdict: "APPROVE",
            severity: "APPROVE",
            approved: true,
            reasons: [],
          }),
      },
      // settings
      {
        get: vi.fn().mockResolvedValue({ preferredTimeframes: [] }),
        getSettings: vi.fn().mockResolvedValue({ proactiveMode: "DEMO" }),
      } as unknown as SettingsService,
      mockQuantPolicy as unknown as QuantExecutionPolicyService,
      // portfolio
      {
        ensureRegisteredStrategies: vi.fn().mockResolvedValue(undefined),
        assignStrategy: vi.fn(),
        processConfluence: vi.fn(),
      } as unknown as PortfolioService,
      mockCollector as unknown as ConfluenceCollectorService,
      mockTradeResearcher as unknown as TradeResearcherService,
      mockCritic as unknown as ChainOfThoughtReflectionService,
      mockSnapshotService as unknown as AnticipatorySnapshotService,
      mockSelfLearning as SelfLearningService,
    );
  });

  // ── Scenario 1: Squeeze probe — full happy path ────────────────────────────

  it('fails closed for stored-context proactive replay instead of mixing in current quotes', async () => {
    const job = { ...makeJob(), trigger: 'REPLAY' as const, useStoredContext: true };
    const result = await pipelineRunner.run(job);
    expect(result).toEqual({ outcome: 'SKIPPED', reason: 'PROACTIVE_STORED_REPLAY_REQUIRES_PINNED_SNAPSHOT' });
    expect(mockLiveTrading.proactiveExecutionEvidence).not.toHaveBeenCalled();
    expect(mockSnapshotService.build).not.toHaveBeenCalled();
    expect(mockTradeResearcher.research).not.toHaveBeenCalled();
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  it('builds a new decision snapshot after quote acquisition, preserving the opportunity cutoff', async () => {
    const eventCutoff = new Date(cutoff);
    const quoteTime = new Date(eventCutoff.getTime() + 20_000);
    vi.mocked(mockLiveTrading.proactiveExecutionEvidence!).mockImplementation(async () => {
      vi.setSystemTime(quoteTime);
      return { timestamp: quoteTime, currentPrice: PRICE, spread: 1, estimatedRoundTripCost: 10,
        tickSize: 0.1, lotSize: 0.001, currentExposure: 0, freshnessThresholdMs: 60_000 };
    });
    const job = makeJob();
    await pipelineRunner.run(job);
    expect(mockSnapshotService.build).toHaveBeenCalledWith(expect.objectContaining({
      sourceDataCutoff: quoteTime,
      execution: expect.objectContaining({ timestamp: quoteTime }),
    }));
    expect(job.params?.sourceDataCutoff).toBe(cutoff);
  });

  it("marks a claimed proactive execution terminal when the execution lock is busy", async () => {
    mockExecutionLock.mockResolvedValue(false);
    await expect(pipelineRunner.run(makeJob())).rejects.toThrow(
      "EXECUTION_LOCK_BUSY",
    );
    const [, terminalUpdate] = mockRunUpdates.mock.calls.at(-1)! as [
      string,
      {
        status?: string;
        errorCode?: string;
        completedAt?: Date;
      },
    ];
    expect(terminalUpdate.status).toBe("FAILED");
    expect(terminalUpdate.errorCode).toBe("EXECUTION_LOCK_BUSY");
    expect(terminalUpdate.completedAt).toBeInstanceOf(Date);
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  it("squeeze probe: thesis flows through researcher -> critic -> risk -> submission", async () => {
    vi.stubEnv("PROACTIVE_AI_MODE", "DEMO");

    await pipelineRunner.run(makeJob());

    // All three proactive-AI services must be invoked
    expect(mockSnapshotService.build).toHaveBeenCalledOnce();
    expect(mockTradeResearcher.research).toHaveBeenCalledOnce();
    expect(mockCritic.reflect).toHaveBeenCalledOnce();

    // Risk assessment must receive liquiditySweep and derivativesImbalance from snapshot
    const riskCalls = (
      mockLiveTrading.assessPipelineDecision as ReturnType<typeof vi.fn>
    ).mock.calls;
    expect(riskCalls.length).toBeGreaterThanOrEqual(1);
    const firstCall = riskCalls[0] as [
      { tradePlanContext: Record<string, unknown> },
      ...unknown[],
    ];
    const ctx = firstCall[0].tradePlanContext;
    expect(firstCall[0]).toMatchObject({ requiredEnvironment: "DEMO" });
    expect(mockLiveTrading.hasVerifiedDemoConnection).toHaveBeenCalledWith(
      "user-1",
    );
    expect(ctx.liquiditySweep).toBe(false);
    expect(ctx.proactive).toMatchObject({
      thesis: { stopLoss: 107400, state: "PROBE_READY" },
    });

    // Order must use a verified DEMO connection through submission as well.
    expect(mockLiveTrading.executePipeline).toHaveBeenCalledWith(
      "user-1",
      "run-1",
      { requiredEnvironment: "DEMO" },
    );

    delete process.env.PROACTIVE_AI_MODE;
  });

  it("does not resurrect a directional proactive thesis after a baseline news-corroboration WAIT", async () => {
    mockDecision.decideForUser.mockResolvedValue({
      ...makeFusionResult().fusionOutput,
      decision: "WAIT",
      overrides: ["NEWS_CORROBORATION_INSUFFICIENT"],
    });

    await expect(pipelineRunner.run(makeJob())).resolves.toEqual({
      outcome: "SKIPPED",
      reason: "NEWS_CORROBORATION_INSUFFICIENT",
    });

    expect(mockLiveTrading.assessPipelineDecision).not.toHaveBeenCalled();
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  it("blocks an AI and baseline direction conflict before critic, risk, or execution", async () => {
    mockTradeResearcher.research = vi.fn().mockResolvedValue({
      preferred: createValidShortThesis(),
      alternatives: [],
      researchRunId: "thesis-short",
      contextSnapshotId: "context-short",
    });

    await expect(pipelineRunner.run(makeJob())).resolves.toEqual({
      outcome: "SKIPPED",
      reason: "AI_BASELINE_DIRECTION_CONFLICT",
    });
    expect(mockCritic.reflect).not.toHaveBeenCalled();
    expect(mockLiveTrading.assessPipelineDecision).not.toHaveBeenCalled();
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
    const terminal = mockRunUpdates.mock.calls.at(-1)?.[1] as {
      result?: Record<string, unknown>;
    };
    expect(terminal.result).toMatchObject({
      thesisAttribution: {
        researchPreferredDirection: "SHORT",
        baselineDirection: "LONG",
        directionAgreement: false,
        candidateCount: 1,
        selectionReason: "AI_BASELINE_DIRECTION_CONFLICT",
      },
    });
  });

  it("selects an aligned alternative and gives the critic bounded recent losses", async () => {
    const aligned = {
      ...createValidLongThesis(),
      targets: [{ price: 113000, fraction: 1 }],
      expectedNetR: 4,
    };
    mockTradeResearcher.research = vi.fn().mockResolvedValue({
      preferred: createValidShortThesis(),
      alternatives: [aligned],
      researchRunId: "thesis-candidates",
      contextSnapshotId: "context-candidates",
    });
    vi.mocked(mockSelfLearning.recentLossesForThesis!).mockResolvedValue([
      {
        direction: "LONG",
        setup: "RANGE_REVERSAL",
        regime: "RANGING",
        netR: -1,
        exitReason: "STOP_LOSS",
        entryPrice: 108200,
        exitPrice: 107400,
      },
    ]);

    await pipelineRunner.run(makeJob());

    expect(persistedTheses[0]).toMatchObject({ thesis: aligned });
    expect(mockCritic.reflect).toHaveBeenCalledWith(
      expect.objectContaining({
        thesis: aligned,
        recentLosses: [expect.stringContaining("STOP_LOSS")],
      }),
      "user-1",
    );
  });

  it("continues deterministic review with empty loss context when history lookup fails", async () => {
    vi.mocked(mockSelfLearning.recentLossesForThesis!).mockRejectedValue(
      new Error("history unavailable"),
    );

    await pipelineRunner.run(makeJob());
    expect(mockCritic.reflect).toHaveBeenCalledWith(
      expect.objectContaining({ recentLosses: [] }),
      "user-1",
    );
  });

  it("never borrows baseline probability for immature AI-thesis economics", async () => {
    mockDecision.decideForUser.mockResolvedValue({
      ...makeFusionResult().fusionOutput,
      expectedWinProbability: 0.91,
    });
    vi.mocked(mockSelfLearning.evaluateProfitAuthorityForThesis!).mockResolvedValue({
      action: "PROBE_ONLY",
      sizeFactor: 0.15,
      sampleSize: 12,
      probabilityAuthority: "UNAVAILABLE",
      empiricalWinProbability: null,
      reason: "immature exact lifecycle",
    } as never);

    await pipelineRunner.run(makeJob());

    const assessment = vi.mocked(mockLiveTrading.assessPipelineDecision!).mock.calls[0]?.[0];
    expect(assessment?.decision).toMatchObject({
      expectedWinProbability: 0,
      expectedValue: 0,
      profitFactorEstimate: 1,
      economicsAuthority: {
        probabilityAuthority: "UNAVAILABLE",
        lifecycleAction: "PROBE_ONLY",
        sampleSize: 12,
        empiricalWinProbability: null,
      },
    });
  });

  it("allows a valid immature exact cohort through real gates as a bounded probe", async () => {
    vi.mocked(mockSelfLearning.evaluateProfitAuthorityForThesis!).mockResolvedValue({
      action: "PROBE_ONLY",
      sizeFactor: 0.15,
      sampleSize: 12,
      probabilityAuthority: "UNAVAILABLE",
      empiricalWinProbability: null,
      reason: "immature exact lifecycle",
    } as never);
    const generatedAt = new Date(cutoff).toISOString();
    const fusion = makeFusionResult();
    const completeAnalyses = {
      ...fusion.analyses,
      market: {
        ...fusion.analyses.market,
        dataQuality: "GOOD",
        generatedAt,
        trend: { direction: "UP" },
        liquidity: { spread: "0.01%" },
      },
      technical: {
        ...fusion.analyses.technical,
        dataQuality: "GOOD",
        generatedAt,
        trend: { direction: "UP" },
      },
      news: { ...fusion.analyses.news, dataQuality: "GOOD", generatedAt },
      sentiment: { dataQuality: "GOOD", generatedAt },
      macro: { dataQuality: "GOOD", generatedAt, summary: "neutral", riskFactors: [] },
      onchain: { dataQuality: "GOOD", generatedAt },
    };
    mockFusion.runDetailed.mockResolvedValue({
      ...fusion,
      analyses: completeAnalyses,
    });
    (pipelineRunner as unknown as { riskPolicy: DecisionRiskPolicyService }).riskPolicy =
      new DecisionRiskPolicyService();
    (pipelineRunner as unknown as { judge: DecisionJudgeService }).judge =
      new DecisionJudgeService();

    await expect(pipelineRunner.run(makeJob())).resolves.toMatchObject({
      outcome: "ORDER_SUBMITTED",
    });

    const assessment = vi.mocked(mockLiveTrading.assessPipelineDecision!).mock.calls[0]?.[0];
    expect(assessment?.tradePlanContext?.proactive?.sizeFactor).toBeLessThanOrEqual(0.15);
    expect(mockLiveTrading.executePipeline).toHaveBeenCalledOnce();
  });

  it("persists thesis attribution when the critic cancels execution", async () => {
    vi.mocked(mockCritic.reflect!).mockResolvedValue({
      action: "CANCEL",
      reasonCodes: ["RECENT_EXACT_COHORT_FAILURE"],
      evidenceRefs: [],
      rationale: "Exact recent evidence invalidates the setup",
    });

    await expect(pipelineRunner.run(makeJob())).resolves.toMatchObject({
      outcome: "SKIPPED",
    });

    const terminal = mockRunUpdates.mock.calls.at(-1)?.[1] as {
      result?: Record<string, unknown>;
    };
    expect(terminal.result).toMatchObject({
      thesisAttribution: {
        researchPreferredDirection: "LONG",
        selectedDirection: "LONG",
        baselineDirection: "LONG",
        directionAgreement: true,
        selectionReason: "ALIGNED_CANDIDATE_SELECTED",
      },
    });
  });

  it("prices an AI thesis only from mature exact lifecycle probability", async () => {
    vi.mocked(mockSelfLearning.evaluateProfitAuthorityForThesis!).mockResolvedValue({
      action: "FULL_SIZE",
      sizeFactor: 1,
      sampleSize: 30,
      probabilityAuthority: "EXACT_LIFECYCLE",
      empiricalWinProbability: 0.6,
      reason: "mature exact lifecycle",
    } as never);

    await pipelineRunner.run(makeJob());

    const assessment = vi.mocked(mockLiveTrading.assessPipelineDecision!).mock.calls[0]?.[0];
    expect(assessment?.decision.expectedWinProbability).toBe(0.6);
    expect(assessment?.decision.expectedReward).toBeCloseTo(3.1686, 4);
    expect(assessment?.decision.expectedValue).toBeCloseTo(1.5011, 4);
    expect(assessment?.decision.profitFactorEstimate).toBeCloseTo(4.7528, 4);
  });

  it("retains researcher audit evidence without persisting execution authority after a baseline WAIT", async () => {
    mockDecision.decideForUser.mockResolvedValue({
      ...makeFusionResult().fusionOutput,
      decision: "WAIT",
      overrides: [],
    });

    await expect(pipelineRunner.run(makeJob())).resolves.toEqual({
      outcome: "SKIPPED",
      reason: "BASELINE_DECISION_WAIT",
    });
    expect(mockTradeResearcher.research).toHaveBeenCalledOnce();
    expect(persistedTheses).toHaveLength(0);
    expect(persistedReviews).toHaveLength(0);
    expect(persistedPlans).toHaveLength(0);
    expect(mockLiveTrading.assessPipelineDecision).not.toHaveBeenCalled();
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  it("downgrades a disabled proactive strategy to shadow evidence instead of stopping analysis", async () => {
    mockActiveStrategyKeys.mockResolvedValue([]);

    const result = await pipelineRunner.run(makeJob());

    expect(persistedTheses).toHaveLength(1);
    expect(persistedReviews).toHaveLength(1);
    expect(persistedPlans).toHaveLength(1);
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: "SKIPPED",
      reason: "SKIPPED_BY_PROACTIVE_MODE",
    });
  });

  it("collects shadow evidence for a disabled proactive strategy without requiring a demo connection", async () => {
    mockActiveStrategyKeys.mockResolvedValue([]);
    (
      mockLiveTrading.hasVerifiedDemoConnection as ReturnType<typeof vi.fn>
    ).mockResolvedValue(false);

    const result = await pipelineRunner.run(makeJob());

    expect(persistedTheses).toHaveLength(1);
    expect(persistedReviews).toHaveLength(1);
    expect(persistedPlans).toHaveLength(1);
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: "SKIPPED",
      reason: "SKIPPED_BY_PROACTIVE_MODE",
    });
  });

  it("does not submit a proactive ai-core order when only another requested strategy is active", async () => {
    mockActiveStrategyKeys.mockResolvedValue(["trend"]);
    const job = makeJob();
    job.params = {
      ...job.params,
      strategyIds: ["ai-core", "trend"],
    };

    const result = await pipelineRunner.run(job);

    expect(persistedTheses).toHaveLength(1);
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: "SKIPPED",
      reason: "SKIPPED_BY_PROACTIVE_MODE",
    });
  });

  it.each([
    ["thesis", "persistThesis"],
    ["review", "persistReview"],
    ["plan", "persistExecutionPlan"],
  ] as const)(
    "fails closed when %s persistence fails",
    async (_boundary, method) => {
      mockLifecycle[method].mockRejectedValueOnce(
        new Error(`FAILED_${method}`),
      );

      await expect(pipelineRunner.run(makeJob())).rejects.toThrow(
        `FAILED_${method}`,
      );
      expect(mockLiveTrading.assessPipelineDecision).not.toHaveBeenCalled();
      expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
    },
  );

  it("passes the relational thesis ID to risk instead of the researcher agent-run ID", async () => {
    await pipelineRunner.run(makeJob());

    expect(mockLiveTrading.assessPipelineDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        tradePlanContext: expect.objectContaining({
          proactive: expect.objectContaining({
            thesisId: "relational-thesis-1",
          }) as unknown,
        }) as unknown,
      }),
    );
  });

  it("passes fresh high-news quality and snapshot market causality into the production decision path", async () => {
    const fusionResult = makeFusionResult();
    const freshNews: FusionInput["news"] = {
      summary: "Fresh positive protocol announcement.",
      impact: { level: "HIGH", direction: "POSITIVE" },
      keyEvents: [
        { title: "Protocol approval", impact: "POSITIVE", importance: 90 },
      ],
      themes: [],
      riskSignals: [],
      dataQuality: "GOOD",
      usedTools: ["news.articles.list"],
      latestPublishedAt: cutoff,
      probeEvidence: {
        direction: "POSITIVE",
        importance: 85,
        publishedAt: cutoff,
      },
      generatedAt: cutoff,
    };
    mockFusion.runDetailed.mockResolvedValue({
      ...fusionResult,
      analyses: { ...fusionResult.analyses, news: freshNews },
    });
    mockSnapshotService.build = vi.fn().mockResolvedValue({
      ...makeSnapshot(),
      participation: {
        ...makeSnapshot().participation,
        volumeRatio: 1.6,
        volumeState: "EXPANDING",
      },
    });

    await pipelineRunner.run(makeJob());

    const [, userId, decisionContext] =
      mockDecision.decideForUser.mock.calls.at(-1)! as [
        unknown,
        string,
        {
          newsProbeAuthority?: {
            news?: Record<string, unknown>;
            causality?: Record<string, unknown>;
          };
        },
      ];
    expect(userId).toBe("user-1");
    expect(decisionContext.newsProbeAuthority?.news).toMatchObject({
      importance: 85,
      confidence: 90,
      direction: "POSITIVE",
      publishedAt: cutoff,
    });
    expect(decisionContext.newsProbeAuthority?.causality).toMatchObject({
      priceChangePercent: 2,
      volumeRatio: 1.6,
      deltaOiPercent: 1.2,
    });
  });

  it.each([null, cutoff])(
    "fails closed when high-impact news has only a legacy publication timestamp of %s",
    async (latestPublishedAt) => {
      const fusionResult = makeFusionResult();
      const newsWithoutPublicationTime: FusionInput["news"] = {
        summary: "Reprocessed old positive protocol announcement.",
        impact: { level: "HIGH", direction: "POSITIVE" },
        keyEvents: [
          {
            title: "Old protocol approval",
            impact: "POSITIVE",
            importance: 90,
          },
        ],
        themes: [],
        riskSignals: [],
        dataQuality: "GOOD",
        usedTools: ["news.articles.list"],
        latestPublishedAt,
        // This generic analysis metadata is deliberately not article publication
        // time and must never authorize a fresh news probe.
        provenance: {
          provider: "news-feed",
          sourceTimestamp: cutoff,
          coverage: "FULL",
          unavailableFields: [],
        },
        generatedAt: cutoff,
      };
      mockFusion.runDetailed.mockResolvedValue({
        ...fusionResult,
        analyses: {
          ...fusionResult.analyses,
          news: newsWithoutPublicationTime,
        },
      });

      await pipelineRunner.run(makeJob());

      const metadata = mockDecision.decideForUser.mock.calls[0]?.[2] as Record<
        string,
        unknown
      >;
      expect(metadata.newsProbeAuthority).toBeUndefined();
    },
  );

  it("propagates a corroborated non-exact news decision as a probe to risk sizing", async () => {
    const baseline = makeFusionResult().fusionOutput;
    mockDecision.decideForUser.mockResolvedValue({
      ...baseline,
      executionContext: {
        ...baseline.executionContext,
        action: "PROBE",
        riskTier: "PROBE",
      },
      thesis: { action: "PROBE" },
    });

    await pipelineRunner.run(makeJob());

    expect(mockLiveTrading.assessPipelineDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          executionContext: expect.objectContaining({
            action: "PROBE",
            riskTier: "PROBE",
          }) as unknown,
        }) as unknown,
      }),
    );
  });

  it("caps an immature lifecycle cohort at 0.15 before proactive risk persistence", async () => {
    mockSelfLearning.evaluateProfitAuthorityForThesis = vi
      .fn()
      .mockResolvedValue({
        action: "PROBE_ONLY",
        sizeFactor: 0.15,
        reason: "insufficient exact history",
      });

    await pipelineRunner.run(makeJob());

    expect(mockLiveTrading.assessPipelineDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        tradePlanContext: expect.objectContaining({
          proactive: expect.objectContaining({ sizeFactor: 0.15 }) as unknown,
        }) as unknown,
      }),
    );
    expect(mockLiveTrading.executePipeline).toHaveBeenCalledOnce();
  });

  it("does not persist risk or execute a suppressed exact lifecycle cohort", async () => {
    mockSelfLearning.evaluateProfitAuthorityForThesis = vi
      .fn()
      .mockResolvedValue({
        action: "SUPPRESSED",
        sizeFactor: 0,
        reason: "negative exact expectancy",
      });

    await pipelineRunner.run(makeJob());

    expect(mockLiveTrading.assessPipelineDecision).not.toHaveBeenCalled();
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  // ── Scenario 2: Confirmation add — CONFIRMED stage allowed ────────────────

  it("confirmation add: CONFIRMED stage is allowed when RISK_APPROVED", async () => {
    vi.stubEnv("PROACTIVE_AI_MODE", "DEMO");

    (
      mockLiveTrading.assessPipelineDecision as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      ...makeApprovedRiskAssessment(),
      risk: {
        approved: true,
        positionSize: 0.075,
        tradePlan: {
          stagedEntry: {
            stage: "CONFIRMED",
            probeSizePct: 0.25,
            confirmationSizePct: 0.75,
            combinedRiskLimitPct: 0.005,
          },
        },
      },
    });

    await pipelineRunner.run(makeJob());

    expect(mockTradeResearcher.research).toHaveBeenCalled();
    expect(mockLiveTrading.executePipeline).toHaveBeenCalledOnce();

    delete process.env.PROACTIVE_AI_MODE;
  });

  // ── Scenario 3: Failed invalidation — quant policy BLOCK ──────────────────

  it("failed invalidation: execution skipped when quant policy returns BLOCK", async () => {
    (mockQuantPolicy.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue({
      severity: "BLOCK",
      allowed: false,
      reason: "INVALIDATION_BREACHED",
    });

    await pipelineRunner.run(makeJob());

    expect(mockTradeResearcher.research).toHaveBeenCalled();
    // With BLOCK the candidate is not actionable; executePipeline must not be called
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  // ── Scenario 4: Chase rejection — risk engine rejects ─────────────────────

  it("chase rejection: execution skipped when risk assessment returns RISK_REJECTED", async () => {
    (
      mockLiveTrading.assessPipelineDecision as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      outcome: "RISK_REJECTED",
      reason: "MAX_CHASE_EXCEEDED",
    });

    await pipelineRunner.run(makeJob());

    expect(mockTradeResearcher.research).toHaveBeenCalled();
    // Risk not approved → executePipeline must not be called
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  // ── Scenario 5: Combined-risk cap ─────────────────────────────────────────

  it("combined-risk cap: execution skipped when combined exposure exceeds limit", async () => {
    (
      mockLiveTrading.assessPipelineDecision as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      outcome: "RISK_REJECTED",
      reason: "MAX_DRAWDOWN_EXCEEDED",
    });

    await pipelineRunner.run(makeJob());

    expect(mockTradeResearcher.research).toHaveBeenCalled();
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  // ── Scenario 6: OBSERVE mode ──────────────────────────────────────────────

  it.each(["OBSERVE", "SHADOW"] as const)(
    "%s mode returns SKIPPED without submitting an order",
    async (mode) => {
      process.env.PROACTIVE_AI_MODE = mode;

      const result = await pipelineRunner.run(makeJob());

      expect(mockTradeResearcher.research).toHaveBeenCalledOnce();
      expect(mockTradeResearcher.persistReview).toHaveBeenCalledOnce();
      expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
      expect(result).toEqual({
        outcome: "SKIPPED",
        reason: "SKIPPED_BY_PROACTIVE_MODE",
      });
    },
  );
  it.each(["LIVE", "live", "UNKNOWN", "demo", "", " DEMO "])(
    "rejects unsupported mode %j before assessment or submission",
    async (mode) => {
      vi.stubEnv("PROACTIVE_AI_MODE", mode);
      const result = await pipelineRunner.run(makeJob());
      expect(result).toEqual({
        outcome: "SKIPPED",
        reason: "PROACTIVE_AI_MODE_INVALID",
      });
      expect(mockLiveTrading.assessPipelineDecision).not.toHaveBeenCalled();
      expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
    },
  );

  it("defaults to OBSERVE when the mode is absent", async () => {
    delete process.env.PROACTIVE_AI_MODE;
    expect(await pipelineRunner.run(makeJob())).toEqual({
      outcome: "SKIPPED",
      reason: "SKIPPED_BY_PROACTIVE_MODE",
    });
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  it("fails closed before research when a proactive job has no source opportunity", async () => {
    const job = makeJob();
    delete job.params?.opportunityId;

    await expect(pipelineRunner.run(job)).resolves.toEqual({
      outcome: "SKIPPED",
      reason: "PROACTIVE_OPPORTUNITY_REQUIRED",
    });
    expect(mockTradeResearcher.research).not.toHaveBeenCalled();
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  it("rejects DEMO without a verified demo connection", async () => {
    vi.mocked(mockLiveTrading.hasVerifiedDemoConnection!).mockResolvedValue(
      false,
    );
    await expect(pipelineRunner.run(makeJob())).rejects.toThrow(
      "NO_ELIGIBLE_EXCHANGE_CONNECTION",
    );
    expect(mockLiveTrading.assessPipelineDecision).not.toHaveBeenCalled();
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  it.each(["OBSERVE", "SHADOW", "DEMO"])(
    "keeps batch-tagged proactive jobs on the guarded %s execution path",
    async (mode) => {
      vi.stubEnv("PROACTIVE_AI_MODE", mode);

      const result = await pipelineRunner.run({
        ...makeJob(),
        confluenceBatchId: "batch-1",
      });
      expect(mockCollector.addSignal).not.toHaveBeenCalled();
      if (mode === "DEMO") {
        expect(result).toMatchObject({ outcome: "ORDER_SUBMITTED" });
        expect(mockLiveTrading.assessPipelineDecision).toHaveBeenCalledWith(
          expect.objectContaining({ requiredEnvironment: "DEMO" }),
        );
      } else {
        expect(result).toEqual({
          outcome: "SKIPPED",
          reason: "SKIPPED_BY_PROACTIVE_MODE",
        });
        expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
      }
    },
  );

  it("REQUIRE_TRIGGER cannot submit a directional WATCHING thesis", async () => {
    vi.mocked(mockCritic.reflect!).mockResolvedValue({
      action: "REQUIRE_TRIGGER",
      reasonCodes: [],
      evidenceRefs: [],
      rationale: "wait",
    });
    await pipelineRunner.run(makeJob());
    expect(mockLiveTrading.assessPipelineDecision).not.toHaveBeenCalled();
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });
  it("revalidates expiry after critic review", async () => {
    vi.mocked(mockCritic.reflect!).mockImplementation(() => {
      vi.setSystemTime(new Date("2026-09-09T13:00:00Z"));
      return Promise.resolve({
        action: "APPROVE",
        reasonCodes: [],
        evidenceRefs: [],
        rationale: "valid",
      });
    });
    await pipelineRunner.run(makeJob());
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  it("forces RECOVERY_RECLAIM setup to SHADOW regardless of deployment mode", async () => {
    vi.stubEnv("PROACTIVE_AI_MODE", "DEMO");
    const recoveryThesis = {
      ...createValidLongThesis(),
      setup: "RECOVERY_RECLAIM" as const,
      state: "PROBE_READY" as const,
      targets: [{ price: 112000, fraction: 1 }],
    };
    vi.mocked(mockTradeResearcher.research!).mockResolvedValue({
      preferred: recoveryThesis,
      alternatives: [],
      researchRunId: "thesis-recovery-1",
      contextSnapshotId: "context-1",
    });

    const result = await pipelineRunner.run(makeJob());

    // Because RECOVERY_RECLAIM is forced to SHADOW, live submission (even DEMO) must NOT be called
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: "SKIPPED",
      reason: "RECOVERY_SHADOW_ONLY",
    });
    delete process.env.PROACTIVE_AI_MODE;
  });
});
