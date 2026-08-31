import { describe, expect, it } from "vitest";
import { evaluatePositionManagement } from "../../src/modules/live-trading/domain/position-manager";
import type { TradePlan } from "../../src/modules/risk/domain/trade-plan-engine";

const plan: TradePlan = {
  approved: true,
  regime: "TREND_UP",
  strategy: "TREND_PULLBACK",
  stopLoss: 98,
  takeProfit: 105,
  maxHoldingCandles: 8,
  breakEvenAtR: 0.8,
  trailingAtrMultiple: 2,
  atr: 1,
  timeframeMs: 15 * 60_000,
  estimatedRoundTripCostPct: 0.001,
};

describe("position manager", () => {
  it("moves a LONG stop to guaranteed profit retention when profit reaches +2%", () => {
    const action = evaluatePositionManagement({
      side: "LONG",
      entryPrice: 100,
      markPrice: 102, // +2% profit
      initialStopLoss: 98,
      currentStopLoss: 98,
      openedAt: new Date("2026-08-08T00:00:00Z"),
      now: new Date("2026-08-08T00:15:00Z"),
      partialTaken: false,
      plan,
    });
    // With 2% profit (peakProfitPct >= 0.015), retentionRatio = 0.50 -> locks at least 101.0
    expect(action.tightenedStopLoss).toBe(101);
    expect(action.takePartial).toBe(true);

    const ratcheted = evaluatePositionManagement({
      side: "LONG",
      entryPrice: 100,
      markPrice: 100.5,
      initialStopLoss: 98,
      currentStopLoss: 102.5,
      highestMark: 103,
      openedAt: new Date("2026-08-08T00:00:00Z"),
      now: new Date("2026-08-08T00:30:00Z"),
      partialTaken: true,
      plan,
    });
    expect(ratcheted.tightenedStopLoss).toBeUndefined();
  });

  it("locks in at least 70% of peak profit when price reaches +3% profit, protecting gains against drop", () => {
    const action = evaluatePositionManagement({
      side: "LONG",
      entryPrice: 100,
      markPrice: 101, // current price dropped to +1%
      highestMark: 103, // but peak reached +3% (+3.00)
      initialStopLoss: 98,
      currentStopLoss: 98,
      openedAt: new Date("2026-08-08T00:00:00Z"),
      now: new Date("2026-08-08T00:30:00Z"),
      partialTaken: false,
      plan,
    });

    // Peak profit = +3.00 (3.0%).
    // Tiered retention guarantees at least 70% of peak profit: 3.00 * 0.70 = +2.10.
    // Plus adaptive ATR (0.9 * 1 = 0.9): 103 - 0.9 = 102.10.
    // Guaranteed stop is at 102.10 (+2.10% profit!), protecting against dropping down to 100.9.
    expect(action.tightenedStopLoss).toBeGreaterThanOrEqual(102.1);
  });

  it("locks in at least 80% of peak profit when price reaches +4% profit", () => {
    const action = evaluatePositionManagement({
      side: "LONG",
      entryPrice: 100,
      markPrice: 104, // +4% profit
      highestMark: 104,
      initialStopLoss: 98,
      currentStopLoss: 98,
      openedAt: new Date("2026-08-08T00:00:00Z"),
      partialTaken: false,
      plan,
    });

    // Peak profit = +4.00 (4.0%).
    // Retention guarantees at least 80%: 100 + 4 * 0.80 = 103.20 (+3.20% locked!).
    // Adaptive ATR (0.6 * 1 = 0.6): 104 - 0.6 = 103.40.
    expect(action.tightenedStopLoss).toBeGreaterThanOrEqual(103.2);
  });

  it("marks a stale position for reassessment without requesting a time exit", () => {
    const action = evaluatePositionManagement({
      side: "LONG",
      entryPrice: 100,
      markPrice: 100.2,
      initialStopLoss: 98,
      currentStopLoss: 98,
      openedAt: new Date("2026-08-08T00:00:00Z"),
      now: new Date("2026-08-08T02:00:00Z"),
      partialTaken: false,
      plan,
    });
    expect(action.reassessmentDue).toBe(true);
    expect(action).not.toHaveProperty("timeExit");
  });

  it("does not take a partial after profit has retraced below one R", () => {
    const action = evaluatePositionManagement({
      side: "LONG",
      entryPrice: 100,
      markPrice: 100.2,
      initialStopLoss: 98,
      currentStopLoss: 98,
      highestMark: 103,
      openedAt: new Date("2026-08-08T00:00:00Z"),
      partialTaken: false,
      plan,
    });
    expect(action.peakR).toBe(1.5);
    expect(action.currentR).toBeCloseTo(0.1, 5);
    expect(action.takePartial).toBe(false);
  });

  it("applies symmetric profit retention logic to SHORT positions", () => {
    const action = evaluatePositionManagement({
      side: "SHORT",
      entryPrice: 100,
      markPrice: 98, // +2% profit for SHORT
      initialStopLoss: 102,
      currentStopLoss: 102,
      openedAt: new Date("2026-08-08T00:00:00Z"),
      partialTaken: false,
      plan: { ...plan, regime: "TREND_DOWN" },
    });
    // 50% profit retention for SHORT -> locks stop loss down to 99.0
    expect(action.tightenedStopLoss).toBe(99);
    expect(action.takePartial).toBe(true);
  });
});
