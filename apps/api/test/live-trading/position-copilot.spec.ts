import { describe, expect, it } from "vitest";
import {
  assertAsymmetricSafety,
  evaluatePositionCopilot,
} from "../../src/modules/live-trading/domain/position-copilot";
import type {
  PositionCopilotInput,
} from "../../src/modules/live-trading/domain/position-copilot.types";
import type { TradePlan } from "../../src/modules/risk/domain/trade-plan-engine";

function createMockInput(overrides: Partial<PositionCopilotInput> = {}): PositionCopilotInput {
  const plan: TradePlan = {
    approved: true,
    regime: "TREND_UP",
    strategy: "MOMENTUM_SCALP",
    stopLoss: 59000,
    takeProfit: 62000,
    rewardToRisk: 2.0,
    maxHoldingCandles: 8,
    breakEvenAtR: 0.8,
    atr: 500,
  };

  return {
    positionId: "pos-1",
    symbol: "BTC-USDT",
    side: "LONG",
    entryPrice: 60000,
    markPrice: 60100,
    quantity: 0.1,
    initialStopLoss: 59000,
    currentStopLoss: 59000,
    takeProfit: 62000,
    openedAt: new Date(Date.now() - 15 * 60_000),
    plan,
    triggerEvent: "SCHEDULED_POLL",
    context: {
      markPrice: 60100,
      now: new Date(),
    },
    ...overrides,
  };
}

describe("PositionCopilot Domain Logic", () => {
  describe("assertAsymmetricSafety", () => {
    it("allows tightening LONG stop loss upwards", () => {
      const result = assertAsymmetricSafety("LONG", 59000, 59500);
      expect(result.valid).toBe(true);
    });

    it("strictly blocks widening LONG stop loss downwards", () => {
      const result = assertAsymmetricSafety("LONG", 59000, 58500);
      expect(result.valid).toBe(false);
      expect(result.violation).toContain("SAFETY_GUARD_VIOLATION");
    });

    it("allows tightening SHORT stop loss downwards", () => {
      const result = assertAsymmetricSafety("SHORT", 61000, 60500);
      expect(result.valid).toBe(true);
    });

    it("strictly blocks widening SHORT stop loss upwards", () => {
      const result = assertAsymmetricSafety("SHORT", 61000, 61500);
      expect(result.valid).toBe(false);
      expect(result.violation).toContain("SAFETY_GUARD_VIOLATION");
    });
  });

  describe("evaluatePositionCopilot Scenarios", () => {
    it("triggers DEFENSIVE_EXIT when hostile breaking news breaks thesis", () => {
      const input = createMockInput({
        side: "LONG",
        entryPrice: 60000,
        markPrice: 59800, // down slightly (-0.2R)
        initialStopLoss: 59000,
        currentStopLoss: 59000,
        triggerEvent: "NEWS_SHOCK",
        context: {
          markPrice: 59800,
          newsSentiment: {
            score: -0.85,
            importance: 90,
            headline: "Major exchange security vulnerability exploited",
            isShock: true,
          },
        },
      });

      const decision = evaluatePositionCopilot(input);
      expect(decision.action).toBe("DEFENSIVE_EXIT");
      expect(decision.urgency).toBe("CRITICAL");
      expect(decision.closeRatio).toBe(1.0);
      expect(decision.thesisHealthScore).toBeLessThan(40);
    });

    it("triggers ACCELERATE_TP when momentum exhausts with divergence near resistance", () => {
      const input = createMockInput({
        side: "LONG",
        entryPrice: 60000,
        markPrice: 61500, // +1.5R profit
        initialStopLoss: 59000,
        currentStopLoss: 60100, // breakeven active
        triggerEvent: "MOMENTUM_EXHAUSTION",
        context: {
          markPrice: 61500,
          technicalState: {
            rsi: 78,
            rsiDivergence: "BEARISH",
            nearResistance: true,
          },
        },
      });

      const decision = evaluatePositionCopilot(input);
      expect(decision.action).toBe("ACCELERATE_TP");
      expect(decision.closeRatio).toBe(1.0);
      expect(decision.urgency).toBe("HIGH");
      expect(decision.reason).toContain("Momentum exhaustion");
    });

    it("triggers TIGHTEN_STOP_LOSS on whale alert when position is comfortably in profit", () => {
      const input = createMockInput({
        side: "LONG",
        entryPrice: 60000,
        markPrice: 61000, // +1.0R
        initialStopLoss: 59000,
        currentStopLoss: 59000,
        triggerEvent: "ONCHAIN_WHALE_PRESSURE",
        context: {
          markPrice: 61000,
          onchainFlow: {
            whaleAlertDetected: true,
            inflowSeverity: "HIGH",
          },
        },
      });

      const decision = evaluatePositionCopilot(input);
      expect(decision.action).toBe("TIGHTEN_STOP_LOSS");
      expect(decision.proposedStopLoss).toBeGreaterThan(60000);
      expect(decision.urgency).toBe("HIGH");
    });

    it("returns HOLD when market exhibits normal noise/whipsaw with intact thesis", () => {
      const input = createMockInput({
        side: "LONG",
        entryPrice: 60000,
        markPrice: 60200,
        triggerEvent: "SCHEDULED_POLL",
        context: {
          markPrice: 60200,
        },
      });

      const decision = evaluatePositionCopilot(input);
      expect(decision.action).toBe("HOLD");
      expect(decision.thesisHealthScore).toBeGreaterThanOrEqual(60);
      expect(decision.urgency).toBe("LOW");
    });
  });
});
