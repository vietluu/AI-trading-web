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

import type { FusionService } from "../../src/modules/agents/application/services/fusion.service";
import type { DecisionService } from "../../src/modules/agents/application/services/decision.service";
import type { PipelineRepository } from "../../src/modules/pipeline/infrastructure/pipeline.repository";
import type { PipelineCancellationService } from "../../src/modules/pipeline/infrastructure/pipeline-cancellation.service";
import type { PipelineAlertService } from "../../src/modules/pipeline/application/pipeline-alert.service";
import type { PipelineAnalyticsService } from "../../src/modules/pipeline/application/pipeline-analytics.service";
import type { PortfolioService } from "../../src/modules/portfolio/application/portfolio.service";
import type { ConfluenceCollectorService } from "../../src/modules/pipeline/infrastructure/confluence-collector.service";
import type { PipelineJob } from "../../src/modules/pipeline/infrastructure/pipeline-queue.service";
import type { MarketDataService } from "../../src/market-data/application/market-data.service";
import type { SettingsService } from "../../src/settings/settings.service";
import type { RedisService } from "../../src/redis/redis.service";
import type { DecisionOutput } from "@platform/shared";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SYMBOL = "BTC-USDT";
const PRICE = 100_000;

const makeJob = (): PipelineJob => ({
  runId: "run-1",
  pipelineId: "proactive-thesis",
  userId: "user-1",
  provider: "BINANCE_FUTURES",
  symbol: SYMBOL,
  params: { interval: "15m", lookbackCandles: 150 },
  trigger: "SCHEDULE",
  createdAt: new Date().toISOString(),
});

const makeFusionResult = () => ({
  analyses: {
    market: { volatility: { atr: 800 }, impact: { level: "LOW", direction: "NEUTRAL" } },
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
    weighting: { technical: 0.5, market: 0.5, news: 0, sentiment: 0, macro: 0, onchain: 0 },
    expectedWinProbability: 0.6,
    volatilityAdjustment: 0,
    overrides: [],
    profitFactorEstimate: 2,
    adaptiveThreshold: 50,
    calibrationAdjustment: 0,
    executionCost: 0,
  },
  cacheHits: {},
});

const makeSnapshot = () => ({
  structure: {
    coverage: "AVAILABLE",
    liquiditySweep: {
      coverage: "AVAILABLE",
      detected: true,
      direction: "BULLISH_SWEEP",
      penetration: 80,
      reclaimed: true,
    },
  },
  derivatives: {
    coverage: "AVAILABLE",
    derivativesImbalance: {
      coverage: "AVAILABLE",
      squeezeProbability: 80,
      squeezeDirection: "LONG_SQUEEZE",
      fundingExtreme: "NORMAL",
    },
  },
});

const makeApprovedRiskAssessment = () => ({
  outcome: "RISK_APPROVED" as const,
  price: PRICE,
  risk: {
    approved: true,
    positionSize: 0.1,
    tradePlan: {
      stagedEntry: { stage: "PROBE", probeSizePct: 0.25, confirmationSizePct: 0.75, combinedRiskLimitPct: 0.005 },
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
  let mockCollector: { addSignal: ReturnType<typeof vi.fn> };

  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.stubEnv("PROACTIVE_AI_MODE", "DEMO");

    mockLiveTrading = {
      executePipeline: vi.fn().mockResolvedValue({ outcome: "ORDER_SUBMITTED" }),
      assessPipelineDecision: vi.fn().mockResolvedValue(makeApprovedRiskAssessment()),
      hasVerifiedDemoConnection: vi.fn().mockResolvedValue(true),
    };

    mockTradeResearcher = {
      research: vi.fn().mockResolvedValue({
        preferred: {
          direction: "LONG",
          confidence: 85,
          expectedNetR: 3,
          setup: {},
          invalidation: { levels: [{ price: 95_000, reason: "structure" }] },
          missingEvidence: [],
        },
      }),
    };

    mockCritic = {
      reflect: vi.fn().mockResolvedValue({ valid: true, adjustments: [] }),
    };

    mockSnapshotService = {
      build: vi.fn().mockResolvedValue(makeSnapshot()),
    };

    mockQuantPolicy = {
      evaluate: vi.fn().mockResolvedValue({ severity: "APPROVE", allowed: true, reasons: [] }),
    };

    const fusionResult = makeFusionResult();
    mockCollector = { addSignal: vi.fn().mockResolvedValue({ ready: true }) };

    pipelineRunner = new PipelineRunnerService(
      // fusion
      { runDetailed: vi.fn().mockResolvedValue(fusionResult) } as unknown as FusionService,
      // decision
      {
        decideForUser: vi.fn().mockResolvedValue(fusionResult.fusionOutput),
        calibrateForExecution: vi.fn().mockImplementation((d: DecisionOutput) => Promise.resolve({ ...fusionResult.fusionOutput, ...d })),
      } as unknown as DecisionService,
      // repository
      {
        updateStep: vi.fn().mockResolvedValue(undefined),
        updateRun: vi.fn().mockResolvedValue(undefined),
        updateJob: vi.fn().mockResolvedValue(undefined),
        markJobFailed: vi.fn().mockResolvedValue(undefined),
        markJobCompleted: vi.fn().mockResolvedValue(undefined),
        activeStrategyKeys: vi.fn().mockResolvedValue(["ai-core"]),
        findRun: vi.fn().mockResolvedValue(null),
      } as unknown as PipelineRepository,
      { isCancelled: vi.fn().mockResolvedValue(false) } as unknown as PipelineCancellationService, // cancellation
      // riskPolicy — always allow through; actual risk eval happens in assessPipelineDecision
      { evaluate: vi.fn().mockReturnValue({ actionable: true, reason: undefined }) },
      // signalFilter
      { evaluate: vi.fn().mockReturnValue({ allowed: true, actionable: true }) },
      // marketData
      {
        getLatestPrice: vi.fn().mockResolvedValue(PRICE),
        getIndicatorSnapshot: vi.fn().mockResolvedValue({
          candleCloseTime: new Date().toISOString(),
          values: {
            close: PRICE, rsi14: 55, atr14: 800,
            ema20: 99_500, ema50: 98_000, ema200: 95_000,
            volumeChangePercent: 5, adx14: 28, efficiencyRatio20: 0.45,
            rollingLow: 97_000, rollingHigh: 103_000,
          },
        }),
        getMarketData: vi.fn().mockResolvedValue({
          "15m": { snapshot: { timestamp: new Date().toISOString() }, indicators: {} },
        }),
        getHistoricalCandles: vi.fn().mockResolvedValue([{
          closeTime: new Date().toISOString(),
          close: PRICE, open: PRICE - 200, high: PRICE + 300, low: PRICE - 400,
        }]),
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
      { recordStageTelemetry: vi.fn() } as unknown as PipelineAnalyticsService,                       // analytics
      mockLiveTrading as unknown as LiveTradingService,
      // redis
      { setNx: vi.fn().mockResolvedValue(true), compareAndDelete: vi.fn().mockResolvedValue(undefined) } as unknown as RedisService,
      // judge
      { evaluate: vi.fn().mockReturnValue({ verdict: "APPROVE", severity: "APPROVE", approved: true, reasons: [] }) },
      // settings
      { get: vi.fn().mockResolvedValue({ preferredTimeframes: [] }), getSettings: vi.fn().mockResolvedValue({ proactiveMode: "DEMO" }) } as unknown as SettingsService,
      mockQuantPolicy as unknown as QuantExecutionPolicyService,
      // portfolio
      { ensureRegisteredStrategies: vi.fn().mockResolvedValue(undefined), assignStrategy: vi.fn(), processConfluence: vi.fn() } as unknown as PortfolioService,
      mockCollector as unknown as ConfluenceCollectorService,
      mockTradeResearcher as unknown as TradeResearcherService,
      mockCritic as unknown as ChainOfThoughtReflectionService,
      mockSnapshotService as unknown as AnticipatorySnapshotService,
    );


  });

  // ── Scenario 1: Squeeze probe — full happy path ────────────────────────────

  it("squeeze probe: thesis flows through researcher -> critic -> risk -> submission", async () => {
    vi.stubEnv("PROACTIVE_AI_MODE", "DEMO");

    await pipelineRunner.run(makeJob());

    // All three proactive-AI services must be invoked
    expect(mockSnapshotService.build).toHaveBeenCalledOnce();
    expect(mockTradeResearcher.research).toHaveBeenCalledOnce();
    expect(mockCritic.reflect).toHaveBeenCalledOnce();

    // Risk assessment must receive liquiditySweep and derivativesImbalance from snapshot
    const riskCalls = (mockLiveTrading.assessPipelineDecision as ReturnType<typeof vi.fn>).mock.calls;
    expect(riskCalls.length).toBeGreaterThanOrEqual(1);
    const firstCall = riskCalls[0] as [{ tradePlanContext: Record<string, unknown> }, ...unknown[]];
    const ctx = firstCall[0].tradePlanContext;
    expect(firstCall[0]).toMatchObject({ requiredEnvironment: "DEMO" });
    expect(mockLiveTrading.hasVerifiedDemoConnection).toHaveBeenCalledWith("user-1");
    expect(ctx.liquiditySweep).toBe(true);
    expect(ctx.derivativesImbalance).toBe(80);

    // Order must use a verified DEMO connection through submission as well.
    expect(mockLiveTrading.executePipeline).toHaveBeenCalledWith("user-1", "run-1", { requiredEnvironment: "DEMO" });

    delete process.env.PROACTIVE_AI_MODE;
  });

  // ── Scenario 2: Confirmation add — CONFIRMED stage allowed ────────────────

  it("confirmation add: CONFIRMED stage is allowed when RISK_APPROVED", async () => {
    vi.stubEnv("PROACTIVE_AI_MODE", "DEMO");

    (mockLiveTrading.assessPipelineDecision as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...makeApprovedRiskAssessment(),
      risk: {
        approved: true,
        positionSize: 0.075,
        tradePlan: { stagedEntry: { stage: "CONFIRMED", probeSizePct: 0.25, confirmationSizePct: 0.75, combinedRiskLimitPct: 0.005 } },
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
    (mockLiveTrading.assessPipelineDecision as ReturnType<typeof vi.fn>).mockResolvedValue({
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
    (mockLiveTrading.assessPipelineDecision as ReturnType<typeof vi.fn>).mockResolvedValue({
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
      expect(result).toEqual({ outcome: "SKIPPED", reason: "PROACTIVE_AI_MODE_INVALID" });
      expect(mockLiveTrading.assessPipelineDecision).not.toHaveBeenCalled();
      expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
    },
  );

  it("defaults to OBSERVE when the mode is absent", async () => {
    delete process.env.PROACTIVE_AI_MODE;
    expect(await pipelineRunner.run(makeJob())).toEqual({
      outcome: "SKIPPED", reason: "SKIPPED_BY_PROACTIVE_MODE",
    });
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  it("rejects DEMO without a verified demo connection", async () => {
    vi.mocked(mockLiveTrading.hasVerifiedDemoConnection!).mockResolvedValue(false);
    await expect(pipelineRunner.run(makeJob())).rejects.toThrow("NO_ELIGIBLE_EXCHANGE_CONNECTION");
    expect(mockLiveTrading.assessPipelineDecision).not.toHaveBeenCalled();
    expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
  });

  it.each(["OBSERVE", "SHADOW", "DEMO"])(
    "keeps batch-tagged proactive jobs on the guarded %s execution path",
    async (mode) => {
      vi.stubEnv("PROACTIVE_AI_MODE", mode);

      const result = await pipelineRunner.run({ ...makeJob(), confluenceBatchId: "batch-1" });
      expect(mockCollector.addSignal).not.toHaveBeenCalled();
      if (mode === "DEMO") {
        expect(result).toMatchObject({ outcome: "ORDER_SUBMITTED" });
        expect(mockLiveTrading.assessPipelineDecision).toHaveBeenCalledWith(
          expect.objectContaining({ requiredEnvironment: "DEMO" }),
        );
      } else {
        expect(result).toEqual({ outcome: "SKIPPED", reason: "SKIPPED_BY_PROACTIVE_MODE" });
        expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
      }
    },
  );

});
