import { describe, expect, it, vi } from "vitest";

import { RiskManagementService } from "../src/modules/risk/application/risk-management.service";

describe("RiskManagementService", () => {
  it("uses upsert to avoid duplicate risk assessments under concurrent execution", async () => {
    const tx = {
      riskAssessment: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({
          approved: true,
          reason: "ok",
          positionSize: 1,
          leverage: 3,
          stopLoss: 10,
          takeProfit: 20,
          riskScore: 25,
        }),
        create: vi.fn(),
      },
    };

    const service = new RiskManagementService(
      {} as never,
      { values: { riskPerTrade: 0.01, maxPositions: 3, maxLeverage: 10, maxDrawdown: 0.2, maxExposure: 1, cooldownMs: 0 } } as never,
      { get: vi.fn() } as never,
    );

    await service.assess(tx as never, {
      userId: "11111111-1111-4111-8111-111111111111",
      strategyId: "22222222-2222-4222-8222-222222222222",
      pipelineRunId: "33333333-3333-4333-8333-333333333333",
      symbol: "BTC-USDT",
      decision: {
        decision: "LONG",
        confidence: 0.68,
        reasoning: "Momentum remains favorable",
        signals: {
          bullishFactors: ["Trend is intact"],
          bearishFactors: [],
        },
        risks: [],
        agreementScore: 80,
        dataQuality: "GOOD",
        regime: { type: "TRENDING" },
        weighting: {
          market: 20,
          technical: 20,
          news: 20,
          sentiment: 20,
          macro: 10,
          onchain: 10,
        },
        overrides: [],
        volatilityAdjustment: 0,
        conflictLevel: "LOW",
        opportunityScore: 70,
        expectedWinProbability: 0.7,
        expectedReward: 100,
        expectedLoss: 20,
        expectedValue: 80,
        profitFactorEstimate: 2,
        riskScore: 10,
        adaptiveThreshold: 50,
        calibrationAdjustment: 0,
        executionCost: 5,
        generatedAt: new Date().toISOString(),
      },
      account: {
        balance: 1000 as never,
        equity: 1000 as never,
        peakEquity: 1000 as never,
      },
      positions: [],
      price: 50000,
      volatility: 0.02,
    });

    expect(tx.riskAssessment.upsert).toHaveBeenCalledOnce();
    expect(tx.riskAssessment.create).not.toHaveBeenCalled();
  });
});
