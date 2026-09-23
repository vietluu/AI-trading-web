import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { validateEnvironment } from "../../src/config/environment";
import { RiskConfigService } from "../../src/modules/risk/application/risk-config.service";

describe("RiskConfigService user limits", () => {
  it("defaults automated execution to 0.5% risk and three positions", () => {
    const service = new RiskConfigService(new ConfigService({}));

    expect(service.values).toMatchObject({
      riskPerTrade: 0.005,
      maxPositions: 3,
      maxSameDirectionPositions: 1,
      drawdownReducedPct: 0.08,
      drawdownDiagnosticProbePct: 0.12,
      drawdownHaltPct: 0.15,
    });
  });

  it("uses validated string environment overrides for drawdown tiers", () => {
    const environment = validateEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:password@localhost:5432/platform",
      REDIS_URL: "redis://localhost:6379",
      SESSION_SECRET: "a-secure-production-session-secret-with-32-characters",
      ENCRYPTION_MASTER_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
      COOKIE_SECURE: "true",
      AUTH_EMAIL_SMTP_HOST: "smtp.example.com",
      AUTH_EMAIL_FROM: "AI Trading <no-reply@example.com>",
      DRAWDOWN_REDUCED_PCT: "0.09",
      DRAWDOWN_DIAGNOSTIC_PROBE_PCT: "0.13",
      DRAWDOWN_HALT_PCT: "0.16",
    });

    const service = new RiskConfigService(new ConfigService(environment));

    expect(environment).toMatchObject({
      NODE_ENV: "production",
      DRAWDOWN_REDUCED_PCT: 0.09,
      DRAWDOWN_DIAGNOSTIC_PROBE_PCT: 0.13,
      DRAWDOWN_HALT_PCT: 0.16,
    });
    expect(service.values).toMatchObject({
      drawdownReducedPct: 0.09,
      drawdownDiagnosticProbePct: 0.13,
      drawdownHaltPct: 0.16,
    });
  });

  it("does not let a risk preference exceed the deployment risk ceiling", async () => {
    const prisma = {
      userSetting: {
        findUnique: vi.fn().mockResolvedValue({
          riskPreference: "AGGRESSIVE",
          defaultLeverage: 50,
          maxRiskPerTrade: 0.02,
        }),
      },
    };
    const service = new RiskConfigService(
      new ConfigService({ MAX_LEVERAGE: 50, RISK_PER_TRADE: 0.005 }),
      prisma as never,
    );

    await expect(service.getUserLimits("user-1")).resolves.toMatchObject({
      riskPerTrade: 0.005,
      maxLeverage: 50,
    });
  });

  it.each([
    ["CONSERVATIVE", 50, 50, 0.01],
    ["MODERATE", 50, 50, 0.02],
    ["AGGRESSIVE", 50, 50, 0.02],
  ])("treats explicit %s leverage as a hard ceiling for dynamic sizing", async (
    riskPreference,
    defaultLeverage,
    expectedLeverage,
    expectedRisk,
  ) => {
    const prisma = {
      userSetting: {
        findUnique: vi.fn().mockResolvedValue({ riskPreference, defaultLeverage, maxRiskPerTrade: 0.02 }),
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

  it("honors a numeric user ceiling below 2% for every risk preference", async () => {
    const prisma = {
      userSetting: {
        findUnique: vi.fn().mockResolvedValue({
          riskPreference: "AGGRESSIVE",
          defaultLeverage: 50,
          maxRiskPerTrade: 0.0125,
        }),
      },
    };
    const service = new RiskConfigService(
      new ConfigService({ MAX_LEVERAGE: 50, RISK_PER_TRADE: 0.02 }),
      prisma as never,
    );

    await expect(service.getUserLimits("user-1")).resolves.toMatchObject({
      riskPerTrade: 0.0125,
      maxLeverage: 50,
    });
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
