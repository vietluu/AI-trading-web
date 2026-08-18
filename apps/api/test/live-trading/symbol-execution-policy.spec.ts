import { describe, expect, it } from "vitest";
import { evaluateSymbolExecutionPolicy } from "../../src/modules/live-trading/domain/symbol-execution-policy";

const config = {
  cautionSymbols: ["LINK-USDT", "ETH-USDT"],
  minimumTrades: 5,
  minimumWinRate: 0.45,
  minimumProfitFactor: 1.1,
  strongSignalConfidence: 80,
  strongSignalOpportunity: 75,
  strongSignalExpectedValue: 0.12,
  sizeFactor: 0.5,
};

const decision = {
  decision: "LONG",
  confidence: 82,
  opportunityScore: 80,
  expectedValue: 0.2,
  conflictLevel: "LOW",
  dataQuality: "GOOD",
};

describe("symbol execution policy", () => {
  it("allows a strong LINK signal but reduces its size when history underperforms", () => {
    const result = evaluateSymbolExecutionPolicy({
      symbol: "LINK-USDT",
      decision: decision as never,
      closedTrades: [-10, -8, -6, 4, 5].map((netPnl) => ({ netPnl })),
      config,
    });
    expect(result.allowed).toBe(true);
    expect(result.sizeFactor).toBe(0.5);
    expect(result.evidence?.underperforming).toBe(true);
  });

  it("blocks a mediocre ETH signal while its history underperforms", () => {
    const result = evaluateSymbolExecutionPolicy({
      symbol: "ETH-USDT",
      decision: { ...decision, confidence: 74 } as never,
      closedTrades: [-10, -8, -6, 4, 5].map((netPnl) => ({ netPnl })),
      config,
    });
    expect(result).toEqual(
      expect.objectContaining({
        allowed: false,
        sizeFactor: 0,
        reason: "SYMBOL_CAUTION_QUALITY_GATE",
      }),
    );
  });

  it("does not penalize an uncautioned symbol", () => {
    expect(
      evaluateSymbolExecutionPolicy({
        symbol: "BNB-USDT",
        decision: decision as never,
        closedTrades: Array.from({ length: 10 }, () => ({ netPnl: -1 })),
        config,
      }),
    ).toEqual({ allowed: true, sizeFactor: 1 });
  });

  it("restores normal size after a caution symbol proves positive performance", () => {
    const result = evaluateSymbolExecutionPolicy({
      symbol: "LINK-USDT",
      decision: decision as never,
      closedTrades: [10, 9, 8, 7, -5, -4].map((netPnl) => ({ netPnl })),
      config,
    });
    expect(result).toEqual({ allowed: true, sizeFactor: 1 });
  });
});
