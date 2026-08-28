import { describe, expect, it, vi } from "vitest";
import { LiveTradingService } from "../../src/modules/live-trading/application/live-trading.service";

describe("LiveTradingService LIVE version approval gate", () => {
  const userId = "test-user-id";
  const pipelineRunId = "run-123";

  it("blocks LIVE pipeline execution when strategy version is unapproved", async () => {
    const config = {
      values: {
        mode: "LIVE",
        runtimeEnabled: true,
        availableCollateralWarningRatio: 0.1,
      },
    };
    const prisma = {
      riskAssessment: {
        findUnique: vi.fn().mockResolvedValue({
          id: "risk-1",
          userId,
          pipelineRunId,
          approved: true,
          positionSize: 1,
          leverage: 2,
          symbol: "BTC-USDT",
        }),
      },
      selfLearningConfiguration: {
        findUnique: vi.fn().mockResolvedValue({
          userId,
          approvedVersion: null,
          approvedConfigurationHash: null,
        }),
      },
    };

    const service = new LiveTradingService(
      prisma as never,
      {} as never,
      config as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.executePipeline(userId, pipelineRunId);
    expect(result.outcome).toBe("STRATEGY_VERSION_NOT_APPROVED_FOR_LIVE");
  });

  it("allows DEMO pipeline execution without approved self-learning version", async () => {
    const config = {
      values: {
        mode: "DEMO",
        runtimeEnabled: true,
        availableCollateralWarningRatio: 0.1,
      },
    };
    const prisma = {
      riskAssessment: {
        findUnique: vi.fn().mockResolvedValue({
          id: "risk-1",
          userId,
          pipelineRunId,
          approved: true,
          positionSize: 1,
          leverage: 2,
          symbol: "BTC-USDT",
        }),
      },
      selfLearningConfiguration: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const connections = {
      list: vi.fn().mockResolvedValue([]),
    };

    const service = new LiveTradingService(
      prisma as never,
      connections as never,
      config as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.executePipeline(userId, pipelineRunId);
    expect(result.outcome).toBe("NO_ELIGIBLE_EXCHANGE_CONNECTION");
  });
});
