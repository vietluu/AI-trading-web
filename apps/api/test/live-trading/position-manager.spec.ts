import { describe, expect, it } from "vitest";
import { evaluatePositionManagement } from "../../src/modules/live-trading/domain/position-manager";
import type { TradePlan } from "../../src/modules/risk/domain/trade-plan-engine";

const plan: TradePlan = {
  approved: true,
  regime: "TREND_UP",
  strategy: "TREND_PULLBACK",
  stopLoss: 98,
  takeProfit: 103,
  maxHoldingCandles: 8,
  breakEvenAtR: 0.8,
  trailingAtrMultiple: 2,
  atr: 1,
  timeframeMs: 15 * 60_000,
  estimatedRoundTripCostPct: 0.001,
};

describe("position manager", () => {
  it("moves a LONG stop to fee-adjusted break-even and never loosens it", () => {
    const action = evaluatePositionManagement({
      side: "LONG",
      entryPrice: 100,
      markPrice: 102,
      initialStopLoss: 98,
      currentStopLoss: 98,
      openedAt: new Date("2026-08-08T00:00:00Z"),
      now: new Date("2026-08-08T00:15:00Z"),
      partialTaken: false,
      plan,
    });
    expect(action.tightenedStopLoss).toBe(100.125);
    expect(action.takePartial).toBe(true);

    const ratcheted = evaluatePositionManagement({
      side: "LONG",
      entryPrice: 100,
      markPrice: 100.5,
      initialStopLoss: 98,
      currentStopLoss: 101,
      highestMark: 103,
      openedAt: new Date("2026-08-08T00:00:00Z"),
      now: new Date("2026-08-08T00:30:00Z"),
      partialTaken: true,
      plan,
    });
    expect(ratcheted.tightenedStopLoss).toBeUndefined();
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

  it("applies symmetric break-even logic to SHORT positions", () => {
    const action = evaluatePositionManagement({
      side: "SHORT",
      entryPrice: 100,
      markPrice: 98,
      initialStopLoss: 102,
      currentStopLoss: 102,
      openedAt: new Date("2026-08-08T00:00:00Z"),
      partialTaken: false,
      plan: { ...plan, regime: "TREND_DOWN" },
    });
    expect(action.tightenedStopLoss).toBe(99.875);
    expect(action.takePartial).toBe(true);
  });
});
