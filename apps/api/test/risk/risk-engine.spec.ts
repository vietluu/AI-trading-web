import { describe, expect, it } from "vitest";
import type { DecisionOutput } from "@platform/shared";
import {
  calculateDrawdown,
  calculatePositionSize,
  calculateProtectivePrices,
  evaluateRisk,
  type RiskInput,
  type RiskLimits,
} from "../../src/modules/risk/domain/risk-engine";

const limits: RiskLimits = {
  riskPerTrade: 0.02,
  maxPositions: 3,
  maxLeverage: 3,
  maxDrawdown: 0.15,
  maxExposure: 0.4,
  cooldownMs: 60_000,
  minimumConfidence: 70,
  stopLossPct: 0.02,
  riskRewardRatio: 2.5,
  highVolatility: 0.04,
  abnormalVolatility: 0.15,
  highVolatilitySizeFactor: 0.6,
};

const decision = (overrides: Partial<DecisionOutput> = {}): DecisionOutput => ({
  decision: "LONG",
  confidence: 80,
  reasoning: "test",
  signals: { bullishFactors: [], bearishFactors: [] },
  risks: [],
  agreementScore: 80,
  dataQuality: "GOOD",
  regime: { type: "TRENDING" },
  weighting: {
    market: 20,
    technical: 20,
    news: 15,
    sentiment: 15,
    macro: 15,
    onchain: 15,
  },
  overrides: [],
  volatilityAdjustment: 0,
  conflictLevel: "LOW",
  generatedAt: new Date().toISOString(),
  ...overrides,
});

const input = (overrides: Partial<RiskInput> = {}): RiskInput => ({
  symbol: "BTC-USDT",
  decision: decision(),
  account: { balance: 10_000, equity: 10_000, peakEquity: 10_000 },
  currentPositions: [],
  marketData: { price: 50_000, volatility: 0.02 },
  now: new Date("2026-08-02T00:10:00Z"),
  ...overrides,
});

describe("risk engine", () => {
  it("calculates capital-at-risk sizing and 1:2 protective prices", () => {
    const prices = calculateProtectivePrices("LONG", 50_000, 0.02, 2);
    expect(prices).toEqual({ stopLoss: 49_000, takeProfit: 52_000 });
    expect(calculatePositionSize(10_000, 0.02, 50_000, prices.stopLoss)).toBe(
      0.2,
    );
  });

  it("caps approved size to remaining portfolio exposure", () => {
    const result = evaluateRisk(input(), limits);
    expect(result.approved).toBe(true);
    expect(result.positionSize).toBe(0.08); // $4,000 = 40% of equity
    expect(result.leverage).toBe(3);
    expect(result.stopLoss).toBe(49_000);
    expect(result.takeProfit).toBe(52_500);
  });

  it("reduces leverage and raw size in high volatility", () => {
    const generousExposure = { ...limits, maxExposure: 1 };
    const normal = evaluateRisk(input(), generousExposure);
    const high = evaluateRisk(
      input({ marketData: { price: 50_000, volatility: 0.05 } }),
      generousExposure,
    );
    expect(high.approved).toBe(true);
    expect(high.leverage).toBe(1);
    expect(high.positionSize).toBeCloseTo((normal.positionSize ?? 0) * 0.6);
  });

  it("halts at the maximum drawdown boundary", () => {
    expect(calculateDrawdown(8_500, 10_000)).toBe(0.15);
    expect(
      evaluateRisk(
        input({
          account: { balance: 8_500, equity: 8_500, peakEquity: 10_000 },
        }),
        limits,
      ),
    ).toMatchObject({ approved: false, reason: "MAX_DRAWDOWN_EXCEEDED" });
  });

  it("blocks repeated entries in the same symbol and direction within the cooldown window", () => {
    const result = evaluateRisk(
      input({
        lastTrades: [
          { symbol: "BTC-USDT", direction: "LONG", createdAt: new Date("2026-08-02T00:09:30Z") },
        ],
      }),
      limits,
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("TRADE_COOLDOWN_ACTIVE");
  });

  it("rejects pyramiding when the existing position is not yet profitable", () => {
    const result = evaluateRisk(
      input({
        currentPositions: [{ symbol: "BTC-USDT", size: 0.05, markPrice: 51_000 }],
      }),
      limits,
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("PYRAMIDING_NOT_ALLOWED");
  });

  it.each([
    [
      "low confidence",
      input({ decision: decision({ confidence: 59 }) }),
      "CONFIDENCE_BELOW_THRESHOLD",
    ],
    [
      "conflict",
      input({ decision: decision({ conflictLevel: "HIGH" }) }),
      "HIGH_SIGNAL_CONFLICT",
    ],
    [
      "abnormal volatility",
      input({ marketData: { price: 50_000, volatility: 0.2 } }),
      "ABNORMAL_VOLATILITY",
    ],
    [
      "position limit",
      input({
        currentPositions: [
          { symbol: "ETH-USDT", size: 0.1, markPrice: 3_000 },
          { symbol: "SOL-USDT", size: 1, markPrice: 150 },
          { symbol: "XRP-USDT", size: 100, markPrice: 0.5 },
        ],
      }),
      "MAX_OPEN_POSITIONS_EXCEEDED",
    ],
    [
      "cooldown",
      input({ lastTradeAt: new Date("2026-08-02T00:09:30Z") }),
      "TRADE_COOLDOWN_ACTIVE",
    ],
  ])("rejects %s", (_label, riskInput, reason) => {
    expect(evaluateRisk(riskInput, limits)).toMatchObject({
      approved: false,
      reason,
    });
  });
});
