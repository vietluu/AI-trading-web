import { describe, expect, it, vi } from "vitest";
import { PipelineHealthService } from "../../src/modules/pipeline/application/pipeline-health.service";

describe("PipelineHealthService execution funnel", () => {
  it("reports directional, judge, quant, risk and order conversion with blockers", async () => {
    const groupBy = vi.fn()
      .mockResolvedValueOnce([
        { status: "COMPLETED", _count: { _all: 3 }, _avg: { durationMs: 50, confidence: 70 } },
      ])
      .mockResolvedValueOnce([
        { decision: "WAIT", _count: { _all: 3 } },
      ]);
    const prisma = {
      pipelineRun: {
        groupBy,
        count: vi.fn().mockResolvedValue(3),
        findMany: vi.fn().mockResolvedValue([
          {
            skippedReason: "QUANT_VALIDATION_MISSING",
            result: {
              candidateDecision: { decision: "LONG" },
              judge: { approved: true },
              quant: { allowed: false },
            },
          },
          {
            skippedReason: null,
            result: {
              candidateDecision: { decision: "LONG" },
              judge: { approved: true },
              quant: { allowed: true },
            },
          },
          { skippedReason: "DECISION_IS_WAIT", result: {} },
        ]),
      },
      riskAssessment: { count: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1) },
      liveOrder: { count: vi.fn().mockResolvedValue(1) },
    };
    const service = new PipelineHealthService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const metrics = await service.metrics();

    expect(metrics.execution_funnel).toEqual({
      runs: 3,
      directional_candidates: 2,
      judge_passed: 2,
      quant_passed: 1,
      risk_assessed: 1,
      risk_approved: 1,
      live_orders: 1,
    });
    expect(metrics.top_blocking_reasons).toEqual([
      { reason: "QUANT_VALIDATION_MISSING", count: 1 },
      { reason: "DECISION_IS_WAIT", count: 1 },
    ]);
  });
});
