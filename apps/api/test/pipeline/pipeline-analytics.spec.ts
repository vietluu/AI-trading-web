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
});
