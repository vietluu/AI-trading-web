import { describe, expect, it } from "vitest";

import {
  PipelineAnalyticsService,
  type StageTelemetryRecord,
} from "../../src/modules/pipeline/application/pipeline-analytics.service";

function record(stageName: string, executionResult: string, rejectReason?: string): StageTelemetryRecord {
  return {
    pipelineId: "FULL_ANALYSIS_DECISION",
    runId: `${stageName}-${executionResult}`,
    symbol: "BTC-USDT",
    exchange: "OKX_FUTURES",
    timeframe: "15m",
    stageName,
    inputSummary: "input",
    outputSummary: "output",
    confidence: 70,
    opportunityScore: 68,
    riskScore: 30,
    decision: "LONG",
    ...(rejectReason ? { rejectReason } : {}),
    executionResult,
    durationMs: 10,
    tokenUsage: 0,
    apiCost: 0,
    createdAt: new Date().toISOString(),
  };
}

describe("pipeline telemetry semantics", () => {
  it("counts decision approval but not risk-only approval as execution", () => {
    const service = new PipelineAnalyticsService();
    const result = service.buildRejectionAnalytics([
      record("decision", "APPROVED"),
      record("execution", "RISK_APPROVED", "EXECUTION_FAILED"),
      record("execution", "EXECUTED"),
    ]);

    expect(result).toMatchObject({
      totalSignals: 3,
      acceptedSignals: 2,
      rejectedSignals: 1,
    });
    expect(result.topRejectionReasons).toContainEqual(["EXECUTION_FAILED", 1]);
  });

  it("aggregates adaptive rollout metrics accurately", () => {
    const service = new PipelineAnalyticsService();
    const metrics = service.buildAdaptiveRolloutMetrics([
      {
        ...record("execution", "EXECUTED"),
        regime: "RANGING",
        setup: "RANGE_REVERSION",
        action: "ENTER",
        riskTier: "NORMAL",
        approvedOrderType: "LIMIT",
        submittedOrderType: "LIMIT",
        planDrift: false,
        lifecycleNetR: 1.5,
      },
      {
        ...record("execution", "EXECUTED"),
        regime: "RANGING",
        setup: "TRANSITION_PROBE",
        action: "PROBE",
        riskTier: "PROBE",
        approvedOrderType: "MARKET",
        submittedOrderType: "MARKET",
        planDrift: false,
        lifecycleNetR: -0.5,
      },
      {
        ...record("execution", "WAIT"),
        regime: "TRENDING",
        setup: "BREAKOUT_RETEST",
        action: "WAIT",
        rejectReason: "ENTRY_CHASE_DISTANCE_EXCEEDED",
        triggerDistance: 1.2,
      },
      {
        ...record("execution", "EXECUTED"),
        regime: "TRENDING",
        setup: "TREND_PULLBACK",
        action: "ENTER",
        approvedOrderType: "LIMIT",
        submittedOrderType: "MARKET",
        planDrift: true,
        lifecycleNetR: 0.8,
      },
    ]);

    expect(metrics.totalRecords).toBe(4);
    expect(metrics.rangeOpportunitiesCount).toBe(2);
    expect(metrics.rangeParticipationsCount).toBe(2);
    expect(metrics.rangeParticipationRate).toBe(1);
    expect(metrics.probeCount).toBe(1);
    expect(metrics.chaseCount).toBe(1);
    expect(metrics.chaseRate).toBe(0.25);
    expect(metrics.planDriftCount).toBe(1);
    expect(metrics.postCostExpectancy).toBeCloseTo((1.5 - 0.5 + 0.8) / 3, 4);
    expect(metrics.profitFactor).toBeCloseTo((1.5 + 0.8) / 0.5, 4);
    expect(metrics.maxDrawdownR).toBeCloseTo(0.5, 4);
  });
});
