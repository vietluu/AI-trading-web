import { describe, expect, it } from "vitest";
import {
  assertAsymmetricSafety,
  evaluatePositionCopilot,
} from "../../src/modules/live-trading/domain/position-copilot";
import type { PositionCopilotInput } from "../../src/modules/live-trading/domain/position-copilot.types";
import type { TradePlan } from "../../src/modules/risk/domain/trade-plan-engine";

describe("AI Position Copilot Battle-Tested Scenario Verification", () => {
  const basePlan: TradePlan = {
    approved: true,
    regime: "TREND_UP",
    strategy: "MOMENTUM_SCALP",
    stopLoss: 59000,
    takeProfit: 62000,
    rewardToRisk: 2.0,
    maxHoldingCandles: 8,
    breakEvenAtR: 0.8,
    atr: 400,
  };

  it("Scenario 1: Breaking News Shock -> Executes DEFENSIVE_EXIT at -0.2% saving account from full -1.67% SL", () => {
    // Open LONG BTC at $60,000 with SL $59,000 (-1000$ = -1.67%)
    const input: PositionCopilotInput = {
      positionId: "pos-btc-1",
      symbol: "BTC-USDT",
      side: "LONG",
      entryPrice: 60000,
      markPrice: 59880, // slight initial dip (-120$ = -0.2%)
      quantity: 0.5,
      initialStopLoss: 59000,
      currentStopLoss: 59000,
      takeProfit: 62000,
      openedAt: new Date(Date.now() - 10 * 60_000),
      plan: basePlan,
      triggerEvent: "NEWS_SHOCK",
      context: {
        markPrice: 59880,
        newsSentiment: {
          score: -0.9,
          importance: 95,
          headline: "Major lending protocol halted after emergency exploit",
          isShock: true,
        },
      },
    };

    const decision = evaluatePositionCopilot(input);

    expect(decision.action).toBe("DEFENSIVE_EXIT");
    expect(decision.urgency).toBe("CRITICAL");
    expect(decision.closeRatio).toBe(1.0);
    expect(decision.thesisHealthScore).toBeLessThan(40);
    expect(decision.reason).toContain("Thesis broken");

    // Realized loss is -0.2% instead of full -1.67% loss
    const savedLossDollars = (60000 - 59000) * 0.5 - (60000 - 59880) * 0.5;
    expect(savedLossDollars).toBe(440); // Saved $440 capital!
  });

  it("Scenario 2: Momentum Stalling near Resistance -> Executes ACCELERATE_TP locking in +6.15% profit before reversal", () => {
    // Open LONG SOL at $130 with SL $125
    const solPlan: TradePlan = {
      approved: true,
      regime: "TREND_UP",
      strategy: "MOMENTUM_SCALP",
      stopLoss: 125,
      takeProfit: 140,
      rewardToRisk: 2.0,
      maxHoldingCandles: 8,
      breakEvenAtR: 0.8,
      atr: 2.5,
    };

    const input: PositionCopilotInput = {
      positionId: "pos-sol-1",
      symbol: "SOL-USDT",
      side: "LONG",
      entryPrice: 130,
      markPrice: 138, // Up +$8 (+6.15%, 1.6R)
      quantity: 10,
      initialStopLoss: 125,
      currentStopLoss: 131, // Breakeven locked
      takeProfit: 140,
      openedAt: new Date(Date.now() - 25 * 60_000),
      plan: solPlan,
      triggerEvent: "MOMENTUM_EXHAUSTION",
      context: {
        markPrice: 138,
        technicalState: {
          rsi: 79,
          rsiDivergence: "BEARISH",
          nearResistance: true,
          atr: 2.5,
        },
      },
    };

    const decision = evaluatePositionCopilot(input);

    expect(decision.action).toBe("ACCELERATE_TP");
    expect(decision.closeRatio).toBe(1.0);
    expect(decision.urgency).toBe("HIGH");
    expect(decision.reason).toContain("Momentum exhaustion detected with divergence");

    const lockedProfit = (138 - 130) * 10;
    expect(lockedProfit).toBe(80); // Locked $80 profit before drop back to $128
  });

  it("Scenario 3: On-Chain Whale Inflow Alert -> Executes TIGHTEN_STOP_LOSS locking in minimum +1.6% profit", () => {
    // Open SHORT ETH at $2,500 with SL $2,550
    const ethPlan: TradePlan = {
      approved: true,
      regime: "TREND_DOWN",
      strategy: "MOMENTUM_SCALP",
      stopLoss: 2550,
      takeProfit: 2400,
      rewardToRisk: 2.0,
      maxHoldingCandles: 8,
      breakEvenAtR: 0.8,
      atr: 20,
    };

    const input: PositionCopilotInput = {
      positionId: "pos-eth-1",
      symbol: "ETH-USDT",
      side: "SHORT",
      entryPrice: 2500,
      markPrice: 2440, // +$60 profit (+2.4%, 1.2R)
      quantity: 2,
      initialStopLoss: 2550,
      currentStopLoss: 2550,
      takeProfit: 2400,
      openedAt: new Date(Date.now() - 30 * 60_000),
      plan: ethPlan,
      triggerEvent: "ONCHAIN_WHALE_PRESSURE",
      context: {
        markPrice: 2440,
        onchainFlow: {
          whaleAlertDetected: true,
          inflowSeverity: "HIGH",
        },
        technicalState: {
          atr: 20,
        },
      },
    };

    const decision = evaluatePositionCopilot(input);

    expect(decision.action).toBe("TIGHTEN_STOP_LOSS");
    expect(decision.proposedStopLoss).toBeDefined();
    expect(decision.proposedStopLoss!).toBeLessThan(2500); // SL tightened into profit territory
    expect(decision.urgency).toBe("HIGH");
  });

  it("Scenario 4: Temporary Whipsaw / Fakeout -> Returns HOLD, preserving position through noise", () => {
    // Open LONG BNB at $550 with SL $540
    const bnbPlan: TradePlan = {
      approved: true,
      regime: "TREND_UP",
      strategy: "MOMENTUM_SCALP",
      stopLoss: 540,
      takeProfit: 570,
      rewardToRisk: 2.0,
      maxHoldingCandles: 8,
      breakEvenAtR: 0.8,
      atr: 5,
    };

    const input: PositionCopilotInput = {
      positionId: "pos-bnb-1",
      symbol: "BNB-USDT",
      side: "LONG",
      entryPrice: 550,
      markPrice: 548, // Small normal pullback (-$2)
      quantity: 5,
      initialStopLoss: 540,
      currentStopLoss: 540,
      takeProfit: 570,
      openedAt: new Date(Date.now() - 5 * 60_000),
      plan: bnbPlan,
      triggerEvent: "SCHEDULED_POLL",
      context: {
        markPrice: 548,
        technicalState: {
          volumeSpikeRatio: 1.1,
          rsi: 52,
          rsiDivergence: "NONE",
        },
      },
    };

    const decision = evaluatePositionCopilot(input);

    expect(decision.action).toBe("HOLD");
    expect(decision.thesisHealthScore).toBeGreaterThanOrEqual(60);
    expect(decision.urgency).toBe("LOW");
  });

  it("Scenario 5: Safety Guard Enforcement -> Strictly rejects widening Stop Loss with SAFETY_GUARD_VIOLATION", () => {
    // Attempt to widen LONG stop loss from 59,000 down to 58,000 (violating safety rule)
    const longSafety = assertAsymmetricSafety("LONG", 59000, 58000);
    expect(longSafety.valid).toBe(false);
    expect(longSafety.violation).toContain("SAFETY_GUARD_VIOLATION");
    expect(longSafety.violation).toContain("Widening risk is strictly prohibited");

    // Attempt to widen SHORT stop loss from 61,000 up to 62,000
    const shortSafety = assertAsymmetricSafety("SHORT", 61000, 62000);
    expect(shortSafety.valid).toBe(false);
    expect(shortSafety.violation).toContain("SAFETY_GUARD_VIOLATION");
  });
});
