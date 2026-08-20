import { describe, expect, it, vi } from "vitest";
import { PipelineAlertService } from "../../src/modules/pipeline/application/pipeline-alert.service";

const analyses = (direction: "UP" | "DOWN" | "SIDEWAYS") => ({
  market: { trend: { direction }, volatility: { level: "MEDIUM" } },
  technical: { trend: { direction } },
  news: { impact: { level: "LOW" } },
}) as never;

describe("PipelineAlertService blocked opportunity telemetry", () => {
  it("raises one incident after five aligned signals are blocked by stale Quant evidence", async () => {
    const create = vi.fn<(input: unknown) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: "alert" });
    const prisma = {
      pipelineAlert: {
        create,
        count: vi.fn().mockResolvedValue(5),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new PipelineAlertService(prisma as never, {} as never);

    await service.blockedOpportunity({
      runId: "run-5", userId: "user-1", symbol: "ETH-USDT",
      decision: "LONG", confidence: 75,
      blockedReasons: ["QUANT_VALIDATION_STALE"],
      analyses: analyses("UP"), multiTimeframeConfirmation: 100,
    });

    expect(create).toHaveBeenCalledTimes(2);
    const lastCall: unknown = create.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({
      data: { kind: "MISSED_OPPORTUNITY", delivered: true },
    });
  });

  it("does not count a signal when market and technical direction are not aligned", async () => {
    const prisma = { pipelineAlert: { create: vi.fn(), count: vi.fn(), findFirst: vi.fn() } };
    const service = new PipelineAlertService(prisma as never, {} as never);

    await service.blockedOpportunity({
      runId: "run-1", userId: "user-1", symbol: "ETH-USDT",
      decision: "LONG", confidence: 75,
      blockedReasons: ["QUANT_VALIDATION_STALE"],
      analyses: analyses("SIDEWAYS"), multiTimeframeConfirmation: 100,
    });

    expect(prisma.pipelineAlert.create).not.toHaveBeenCalled();
  });
});
