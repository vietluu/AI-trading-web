import { describe, expect, it } from "vitest";
import {
  AgentProvenanceSchema,
  MarketAgentOutputSchema,
  TechnicalAgentOutputSchema,
  NewsAgentOutputSchema,
  SentimentAgentOutputSchema,
  MacroAgentOutputSchema,
  OnChainAgentOutputSchema,
} from "@platform/shared";

describe("AgentProvenanceSchema and specialist output provenance contracts", () => {
  const validProvenance = {
    provider: "COIN_METRICS",
    sourceTimestamp: "2026-08-28T12:00:00.000Z",
    observationAgeMs: 1200,
    coverage: "FULL" as const,
    unavailableFields: [],
    dataQualityReason: "VERIFIED_ONCHAIN_METRICS_RECEIVED",
  };

  it("validates structured agent provenance schema", () => {
    const parsed = AgentProvenanceSchema.parse(validProvenance);
    expect(parsed.provider).toBe("COIN_METRICS");
    expect(parsed.coverage).toBe("FULL");
    expect(parsed.unavailableFields).toEqual([]);
  });

  it("rejects invalid coverage level", () => {
    expect(() =>
      AgentProvenanceSchema.parse({
        ...validProvenance,
        coverage: "INVALID_COVERAGE",
      }),
    ).toThrow();
  });

  it("validates MarketAgentOutput with provenance metadata", () => {
    const marketOutput = {
      summary: "Market is bullish",
      trend: { direction: "UP", strength: "STRONG" },
      volatility: { level: "MEDIUM" },
      liquidity: {},
      derivatives: {},
      anomalies: [],
      dataQuality: "GOOD",
      usedTools: ["market.ticker.get"],
      generatedAt: "2026-08-28T12:00:00.000Z",
      provenance: {
        provider: "BINANCE_FUTURES",
        sourceTimestamp: "2026-08-28T12:00:00.000Z",
        observationAgeMs: 50,
        coverage: "FULL",
        unavailableFields: [],
      },
    };

    const parsed = MarketAgentOutputSchema.parse(marketOutput);
    expect(parsed.provenance?.provider).toBe("BINANCE_FUTURES");
    expect(parsed.provenance?.coverage).toBe("FULL");
  });

  it("validates TechnicalAgentOutput with provenance metadata", () => {
    const techOutput = {
      summary: "Technical momentum bullish",
      trend: { direction: "UP", strength: "STRONG" },
      momentum: {
        rsi: "62.5",
        rsiState: "NEUTRAL",
        macd: { trend: "BULLISH" },
      },
      movingAverages: {
        alignment: "BULLISH",
        pricePosition: "ABOVE",
      },
      volatility: {
        bollinger: { position: "UPPER", squeeze: false },
      },
      structure: { marketStructure: "HH_HL" },
      signals: [],
      dataQuality: "GOOD",
      usedTools: ["market.candles.list"],
      generatedAt: "2026-08-28T12:00:00.000Z",
      provenance: {
        provider: "BINANCE_FUTURES",
        coverage: "FULL",
        unavailableFields: [],
      },
    };

    const parsed = TechnicalAgentOutputSchema.parse(techOutput);
    expect(parsed.provenance?.coverage).toBe("FULL");
  });

  it("validates NewsAgentOutput with provenance metadata", () => {
    const newsOutput = {
      summary: "Macro events quiet",
      impact: { level: "LOW", direction: "NEUTRAL" },
      keyEvents: [],
      themes: [],
      riskSignals: [],
      dataQuality: "GOOD",
      usedTools: ["news.articles.list"],
      generatedAt: "2026-08-28T12:00:00.000Z",
      provenance: {
        provider: "RSS_INGESTION",
        coverage: "FULL",
        unavailableFields: [],
      },
    };

    const parsed = NewsAgentOutputSchema.parse(newsOutput);
    expect(parsed.provenance?.provider).toBe("RSS_INGESTION");
  });

  it("validates SentimentAgentOutput with provenance metadata", () => {
    const sentimentOutput = {
      summary: "Sentiment slightly bullish",
      sentiment: { overall: "BULLISH", intensity: "MEDIUM" },
      crowdBehavior: { fomo: false, panic: false, euphoria: false },
      sources: {},
      anomalies: [],
      dataQuality: "GOOD",
      usedTools: ["sentiment.market.get"],
      generatedAt: "2026-08-28T12:00:00.000Z",
      provenance: {
        provider: "ALTERNATIVE_ME_REDDIT",
        coverage: "PARTIAL",
        unavailableFields: ["twitter"],
        dataQualityReason: "TWITTER_API_UNAVAILABLE",
      },
    };

    const parsed = SentimentAgentOutputSchema.parse(sentimentOutput);
    expect(parsed.provenance?.coverage).toBe("PARTIAL");
    expect(parsed.provenance?.unavailableFields).toContain("twitter");
  });

  it("validates MacroAgentOutput with provenance metadata", () => {
    const macroOutput = {
      summary: "Macro risk neutral",
      macroTrend: "NEUTRAL",
      keyEvents: [],
      riskFactors: [],
      dataQuality: "GOOD",
      generatedAt: "2026-08-28T12:00:00.000Z",
      provenance: {
        provider: "ECONOMIC_CALENDAR",
        coverage: "FULL",
        unavailableFields: [],
      },
    };

    const parsed = MacroAgentOutputSchema.parse(macroOutput);
    expect(parsed.provenance?.coverage).toBe("FULL");
  });

  it("validates OnChainAgentOutput with provenance metadata and unsupported reason", () => {
    const onchainOutput = {
      summary: "No verified on-chain coverage for asset",
      activity: "LOW",
      flows: {},
      signals: [],
      dataQuality: "INSUFFICIENT",
      generatedAt: "2026-08-28T12:00:00.000Z",
      provenance: {
        provider: "COIN_METRICS",
        coverage: "EMPTY",
        unavailableFields: ["exchangeInflow", "exchangeOutflow", "activeAddresses"],
        dataQualityReason: "ASSET_NOT_SUPPORTED_BY_ONCHAIN_PROVIDER",
      },
    };

    const parsed = OnChainAgentOutputSchema.parse(onchainOutput);
    expect(parsed.provenance?.coverage).toBe("EMPTY");
    expect(parsed.provenance?.dataQualityReason).toBe("ASSET_NOT_SUPPORTED_BY_ONCHAIN_PROVIDER");
  });
});
