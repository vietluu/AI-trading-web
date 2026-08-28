import { describe, expect, it } from "vitest";
import { QUALITY_FACTOR } from "../../src/modules/agents/domain/constants/decision.constants";
import { DecisionService } from "../../src/modules/agents/application/services/decision.service";
import { FusionService } from "../../src/modules/agents/application/services/fusion.service";

describe("Data-Quality Driven Decision Weighting", () => {
  it("enforces strict QUALITY_FACTOR values: GOOD=1, PARTIAL=0.5, INSUFFICIENT=0", () => {
    expect(QUALITY_FACTOR.GOOD).toBe(1);
    expect(QUALITY_FACTOR.PARTIAL).toBe(0.5);
    expect(QUALITY_FACTOR.INSUFFICIENT).toBe(0);
  });

  it("down-weights PARTIAL analyst and gives zero weight to INSUFFICIENT analyst", () => {
    const fusionService = {} as unknown as FusionService;
    const service = new DecisionService(fusionService);

    const baseInput = {
      symbol: "BTC-USDT",
      fusionOutput: {
        summary: "Fusion test",
        combinedAnalysis: {
          market: "Market up",
          technical: "Tech up",
          news: "News positive",
          sentiment: "Sentiment neutral",
          macro: "Macro neutral",
          onchain: "Onchain unavailable",
        },
        overallBias: "BULLISH" as const,
        confidence: 70,
        conflicts: [],
        dataQuality: "GOOD" as const,
        generatedAt: new Date().toISOString(),
      },
      market: {
        summary: "Market trend strong",
        trend: { direction: "UP" as const, strength: "STRONG" as const },
        volatility: { level: "LOW" as const },
        liquidity: {},
        derivatives: {},
        anomalies: [],
        dataQuality: "GOOD" as const,
        usedTools: ["market.ticker.get" as const],
        generatedAt: new Date().toISOString(),
      },
      technical: {
        summary: "Technical momentum strong",
        trend: { direction: "UP" as const, strength: "STRONG" as const },
        momentum: { rsi: "60", rsiState: "NEUTRAL" as const, macd: { trend: "BULLISH" as const } },
        movingAverages: { alignment: "BULLISH" as const, pricePosition: "ABOVE" as const },
        volatility: { bollinger: { position: "UPPER" as const, squeeze: false } },
        structure: { marketStructure: "HH_HL" as const },
        signals: [],
        dataQuality: "GOOD" as const,
        usedTools: ["market.candles.list" as const],
        generatedAt: new Date().toISOString(),
      },
      news: {
        summary: "Neutral news",
        impact: { level: "LOW" as const, direction: "NEUTRAL" as const },
        keyEvents: [],
        themes: [],
        riskSignals: [],
        dataQuality: "PARTIAL" as const, // PARTIAL news should be down-weighted
        usedTools: ["news.articles.list" as const],
        generatedAt: new Date().toISOString(),
      },
      sentiment: {
        summary: "Neutral sentiment",
        sentiment: { overall: "NEUTRAL" as const, intensity: "LOW" as const },
        crowdBehavior: { fomo: false, panic: false, euphoria: false },
        sources: {},
        anomalies: [],
        dataQuality: "PARTIAL" as const, // PARTIAL sentiment
        usedTools: ["sentiment.market.get" as const],
        generatedAt: new Date().toISOString(),
      },
      macro: {
        summary: "Neutral macro",
        macroTrend: "NEUTRAL" as const,
        keyEvents: [],
        riskFactors: [],
        dataQuality: "GOOD" as const,
        generatedAt: new Date().toISOString(),
      },
      onchain: {
        summary: "No verified onchain metrics",
        activity: "NORMAL" as const,
        flows: {},
        signals: [],
        dataQuality: "INSUFFICIENT" as const, // INSUFFICIENT onchain should have ZERO weight
        generatedAt: new Date().toISOString(),
      },
    };

    const output = service.decide(baseInput);

    expect(output.decision).toBe("LONG");
    expect(output.signals.bullishFactors.length).toBeGreaterThan(0);
    // OnChain has INSUFFICIENT quality -> cannot contribute bullish/bearish signals
    expect(output.signals.bullishFactors.some(f => f.toLowerCase().includes("on-chain"))).toBe(false);
  });
});
