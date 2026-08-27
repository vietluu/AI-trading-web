import { describe, expect, it } from "vitest";
import { ExchangeInterval, ExchangeProvider } from "../../src/exchange/domain/exchange.types";
import {
  directionalValidationDemands,
  prioritizeValidationCandidates,
  scheduledStrategyKeys,
} from "../../src/modules/research/application/quant-research-scheduler.service";

describe("QuantResearchScheduler coverage", () => {
  it("derives coverage from enabled schedule strategies and includes the bounded scalp companion", () => {
    expect(scheduledStrategyKeys([
      { strategyIds: ["trend", "breakout", "unknown-strategy"] },
    ])).toEqual(["ai-core", "trend", "breakout", "momentum-scalp"]);
  });

  it("prioritizes missing and oldest validations instead of restarting from ai-core", () => {
    const provider = ExchangeProvider.OKX_FUTURES;
    const ordered = prioritizeValidationCandidates([
      { strategyKey: "ai-core", symbol: "ETH-USDT", interval: ExchangeInterval.FIFTEEN_MINUTES, provider, previous: new Date("2026-08-19T00:00:00Z") },
      { strategyKey: "trend", symbol: "ETH-USDT", interval: ExchangeInterval.FIFTEEN_MINUTES, provider, previous: new Date("2026-08-12T00:00:00Z") },
      { strategyKey: "breakout", symbol: "ETH-USDT", interval: ExchangeInterval.FIFTEEN_MINUTES, provider },
    ], new Date("2026-08-20T00:00:00Z"));

    expect(ordered[0]?.strategyKey).toBe("breakout");
    expect(ordered[1]?.strategyKey).toBe("trend");
    expect(ordered[2]?.strategyKey).toBe("ai-core");
  });

  it("refreshes active portfolio strategy pairs before unrelated missing scope", () => {
    const provider = ExchangeProvider.OKX_FUTURES;
    const ordered = prioritizeValidationCandidates([
      { strategyKey: "ai-core", symbol: "ZRO-USDT", interval: ExchangeInterval.FIFTEEN_MINUTES, provider },
      { strategyKey: "trend", symbol: "BTC-USDT", interval: ExchangeInterval.FIFTEEN_MINUTES, provider, previous: new Date("2026-08-12T00:00:00Z"), priority: 0 },
    ], new Date("2026-08-21T00:00:00Z"));

    expect(ordered[0]?.strategyKey).toBe("trend");
    expect(ordered[0]?.symbol).toBe("BTC-USDT");
  });

  it("extracts exact validation demand from a recently blocked directional candidate", () => {
    expect(directionalValidationDemands([
      {
        symbol: "SOL-USDT",
        provider: "OKX_FUTURES",
        timeframe: "15m",
        storedContext: {
          candidateDecision: {
            decision: "LONG",
            strategyKey: "ai-core",
            provider: "OKX_FUTURES",
            timeframe: "15m",
            blockedReasons: ["QUANT_PROBABILITY_TOO_LOW"],
          },
        },
      },
      {
        symbol: "BTC-USDT",
        provider: "OKX_FUTURES",
        timeframe: "15m",
        storedContext: {
          candidateDecision: {
            decision: "WAIT",
            strategyKey: "ai-core",
            blockedReasons: ["QUANT_VALIDATION_MISSING"],
          },
        },
      },
    ])).toEqual([
      {
        strategyKey: "ai-core",
        symbol: "SOL-USDT",
        interval: "15m",
        provider: "OKX_FUTURES",
      },
    ]);
  });

  it("places blocked directional demand ahead of ordinary portfolio coverage", () => {
    const provider = ExchangeProvider.OKX_FUTURES;
    const ordered = prioritizeValidationCandidates([
      { strategyKey: "trend", symbol: "BTC-USDT", interval: ExchangeInterval.FIFTEEN_MINUTES, provider, priority: 0 },
      { strategyKey: "ai-core", symbol: "SOL-USDT", interval: ExchangeInterval.FIFTEEN_MINUTES, provider, priority: -2 },
    ], new Date("2026-08-27T00:00:00Z"));

    expect(ordered[0]?.symbol).toBe("SOL-USDT");
  });
});
