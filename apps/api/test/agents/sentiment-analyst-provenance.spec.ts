import { describe, expect, it } from "vitest";
import { SENTIMENT_ANALYST_DEFINITION } from "../../src/modules/agents/domain/definitions/sentiment-analyst.definition";

describe("Sentiment Analyst Provenance and Source Normalization", () => {
  it("builds INSUFFICIENT output with EMPTY provenance when no sources are available", () => {
    const output = SENTIMENT_ANALYST_DEFINITION.buildDeterministicOutput({});

    expect(output.dataQuality).toBe("INSUFFICIENT");
    expect(output.sentiment.overall).toBe("NEUTRAL");
    expect(output.provenance?.coverage).toBe("EMPTY");
    expect(output.provenance?.dataQualityReason).toBe("NO_SOCIAL_OR_SENTIMENT_SOURCES_AVAILABLE");
    expect(output.provenance?.unavailableFields).toContain("fearAndGreedIndex");
  });

  it("builds PARTIAL output when only global Fear & Greed index is available", () => {
    const output = SENTIMENT_ANALYST_DEFINITION.buildDeterministicOutput({
      "sentiment.market.get": {
        dataAvailable: true,
        score: 72,
        classification: "Greed",
        timestamp: "2026-08-28T12:00:00Z",
      },
    });

    expect(output.dataQuality).toBe("PARTIAL");
    expect(output.sentiment.overall).toBe("BULLISH");
    expect(output.provenance?.coverage).toBe("PARTIAL");
    expect(output.provenance?.unavailableFields).toEqual(["socialPosts"]);
    expect(output.provenance?.dataQualityReason).toBe("GLOBAL_INDEX_AVAILABLE_ASSET_SOCIAL_UNAVAILABLE");
  });

  it("builds FULL output with GOOD quality when both index and social posts are available", () => {
    const output = SENTIMENT_ANALYST_DEFINITION.buildDeterministicOutput({
      "sentiment.market.get": {
        dataAvailable: true,
        score: 20,
        classification: "Extreme Fear",
        timestamp: "2026-08-28T12:00:00Z",
      },
      "social.posts.list": {
        posts: [
          { id: "p1", source: "reddit", title: "Market crashing", sentiment: "BEARISH" },
        ],
      },
    });

    expect(output.dataQuality).toBe("GOOD");
    expect(output.sentiment.overall).toBe("BEARISH");
    expect(output.provenance?.coverage).toBe("FULL");
    expect(output.provenance?.unavailableFields).toEqual([]);
  });
});
