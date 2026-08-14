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
  estimatedRoundTripCostPct: 0.0008,
  maxStopLossRoe: 0.03,
  rangeScalpRoeMultiplier: 2,
  minLiquidationBufferPct: 0.01,
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
  opportunityScore: 72,
  expectedWinProbability: 0.72,
  expectedReward: 1.6,
  expectedLoss: 0.8,
  expectedValue: 0.7,
  profitFactorEstimate: 2,
  riskScore: 30,
  adaptiveThreshold: 60,
  calibrationAdjustment: 0,
  executionCost: 0.05,
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
    expect(result.leverage).toBe(1);
    expect(result.stopLoss).toBe(49_000);
    expect(result.takeProfit).toBe(52_500);
    expect(result.plannedEquityRiskPct).toBeLessThanOrEqual(0.02);
    expect(result.plannedMarginRoe).toBeLessThanOrEqual(0.03);
  });

  it("includes round-trip costs in sizing and never exceeds the equity risk budget", () => {
    const result = evaluateRisk(input(), { ...limits, maxExposure: 1 });
    expect(result.approved).toBe(true);
    expect(result.positionSize).toBeCloseTo(200 / 1040, 8);
    expect(result.plannedLoss).toBeCloseTo(200, 5);
    expect(result.plannedEquityRiskPct).toBeCloseTo(0.02, 8);
  });

  it("caps leverage from stop-loss margin ROE after final position sizing", () => {
    const result = evaluateRisk(input(), {
      ...limits,
      maxLeverage: 50,
      maxExposure: 1,
      maxStopLossRoe: 0.03,
    });
    expect(result.approved).toBe(true);
    expect(result.leverage).toBe(1);
    expect(result.plannedMarginRoe).toBeCloseTo(0.0208, 8);
  });

  it("selects the minimum safe leverage required by available funds", () => {
    const result = evaluateRisk(input({
      account: {
        balance: 10_000,
        equity: 10_000,
        peakEquity: 10_000,
        availableBalance: 2_100,
      },
    }), {
      ...limits,
      maxExposure: 0.4,
      maxLeverage: 10,
      maxStopLossRoe: 0.25,
    });

    expect(result.approved).toBe(true);
    expect(result.leverage).toBe(2);
    expect((result.positionSize ?? 0) * 50_000 / (result.leverage ?? 1))
      .toBeLessThanOrEqual(2_100 * 0.98);
  });

  it("shrinks size when available funds would require unsafe leverage", () => {
    const result = evaluateRisk(input({
      account: {
        balance: 10_000,
        equity: 10_000,
        peakEquity: 10_000,
        availableBalance: 1_000,
      },
    }), limits);

    expect(result.approved).toBe(true);
    expect(result.leverage).toBe(1);
    expect(result.positionSize).toBe(0.0196);
    expect((result.positionSize ?? 0) * 50_000).toBeLessThanOrEqual(980);
  });

  it("uses only the funding-required leverage for a range scalp", () => {
    const rangeInput = input({
      marketData: {
        price: 100,
        volatility: 0.01,
        tradePlanContext: {
          atr: 0.2,
          support: 99.8,
          resistance: 101.5,
          marketStructure: "RANGE",
          timeframeMs: 60_000,
        },
      },
      decision: decision({ regime: { type: "RANGING" } }),
    });
    const result = evaluateRisk(rangeInput, {
      ...limits,
      maxLeverage: 50,
      maxExposure: 1,
    });

    expect(result.approved).toBe(true);
    expect(result.tradePlan?.strategy).toBe("RANGE_REVERSAL");
    expect(result.leverage).toBe(2);
    expect(result.leverage).toBeLessThanOrEqual(50);
    expect(result.plannedMarginRoe).toBeLessThanOrEqual(0.06);
  });

  it("reduces leverage budget for longer timeframe range positions", () => {
    const make = (timeframeMs: number) => evaluateRisk(input({
      account: {
        balance: 10_000,
        equity: 10_000,
        peakEquity: 10_000,
        availableBalance: 500,
      },
      marketData: {
        price: 100,
        volatility: 0.01,
        tradePlanContext: {
          atr: 0.2, support: 99.8, resistance: 101.5,
          marketStructure: "RANGE", timeframeMs,
        },
      },
      decision: decision({ regime: { type: "RANGING" } }),
    }), { ...limits, maxLeverage: 50, maxExposure: 1 });

    const short = make(5 * 60_000);
    const long = make(4 * 3_600_000);
    expect(short.approved).toBe(true);
    expect(long.approved).toBe(true);
    expect(short.leverage).toBeGreaterThan(long.leverage ?? 0);
  });

  it("fails closed when even 1x would exceed the margin ROE limit", () => {
    const result = evaluateRisk(input(), { ...limits, maxStopLossRoe: 0.015 });
    expect(result).toMatchObject({
      approved: false,
      reason: "STOP_LOSS_ROE_EXCEEDS_LIMIT",
    });
  });

  it("regresses the ETH incident: a tight ATR stop cannot produce 34x leverage", () => {
    const result = evaluateRisk(input({
      symbol: "ETH-USDT",
      decision: decision({
        decision: "SHORT",
        confidence: 84,
        dataQuality: "PARTIAL",
        regime: { type: "RANGING" },
      }),
      account: {
        balance: 77_794.46,
        equity: 77_794.46,
        peakEquity: 77_794.46,
      },
      marketData: {
        price: 1_865.5,
        volatility: 5.3403 / 1_865.5,
        tradePlanContext: {
          atr: 5.3403,
          adx: 25,
          efficiencyRatio: 0.4,
          ema20: 1_863,
          ema50: 1_868,
          marketStructure: "LH_LL",
          timeframeMs: 15 * 60_000,
        },
      },
    }), { ...limits, maxLeverage: 5, maxExposure: 0.6 });

    expect(result.approved).toBe(true);
    expect(result.leverage).toBeLessThanOrEqual(5);
    expect(result.leverage).not.toBe(34);
    expect(result.plannedEquityRiskPct).toBeLessThanOrEqual(0.02);
    expect(result.plannedMarginRoe).toBeLessThanOrEqual(0.03);
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
