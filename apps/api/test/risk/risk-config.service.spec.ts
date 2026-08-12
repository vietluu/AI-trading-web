import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { RiskConfigService } from "../../src/modules/risk/application/risk-config.service";

describe("RiskConfigService user limits", () => {
  it.each([
    ["CONSERVATIVE", 50, 50, 0.01],
    ["MODERATE", 50, 50, 0.02],
    ["AGGRESSIVE", 50, 50, 0.04],
  ])("treats explicit %s leverage as a hard ceiling for dynamic sizing", async (
    riskPreference,
    defaultLeverage,
    expectedLeverage,
    expectedRisk,
  ) => {
    const prisma = {
      userSetting: {
        findUnique: vi.fn().mockResolvedValue({ riskPreference, defaultLeverage }),
      },
    };
    const service = new RiskConfigService(new ConfigService({
      MAX_LEVERAGE: 50,
      RISK_PER_TRADE: 0.02,
      ESTIMATED_ROUND_TRIP_COST_PCT: 0.0008,
      MAX_STOP_LOSS_ROE: 0.03,
    }), prisma as never);

    const result = await service.getUserLimits("user-1");
    expect(result.maxLeverage).toBe(expectedLeverage);
    expect(result.riskPerTrade).toBe(expectedRisk);
    expect(result.estimatedRoundTripCostPct).toBe(0.0008);
    expect(result.maxStopLossRoe).toBe(0.03);
  });

  it("fails safe when the user preference cannot be loaded", async () => {
    const prisma = {
      userSetting: {
        findUnique: vi.fn().mockRejectedValue(new Error("database unavailable")),
      },
    };
    const service = new RiskConfigService(
      new ConfigService({ MAX_LEVERAGE: 50, RISK_PER_TRADE: 0.04, MAX_EXPOSURE: 0.8 }),
      prisma as never,
    );

    await expect(service.getUserLimits("user-1")).resolves.toMatchObject({
      maxLeverage: 3,
      riskPerTrade: 0.02,
      maxExposure: 0.6,
    });
  });
});
