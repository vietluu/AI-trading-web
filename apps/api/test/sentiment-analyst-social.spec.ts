import { describe, expect, it } from "vitest";
import { SENTIMENT_ANALYST_DEFINITION } from "../src/modules/agents/domain/definitions/sentiment-analyst.definition";

const makeToolData = (fearValue: number, posts: object[]) => ({
  "sentiment.market.get": {
    value: fearValue,
    label: fearValue < 35 ? "Fear" : fearValue > 65 ? "Greed" : "Neutral",
  },
  "social.posts.list": { posts },
});

describe("SENTIMENT_ANALYST_DEFINITION - social keyword scoring", () => {
  it("should return BULLISH when majority posts have bullish keywords, even with neutral fear index", () => {
    const result = SENTIMENT_ANALYST_DEFINITION.buildDeterministicOutput!(
      makeToolData(50, [
        { title: "BTC moon rally incoming huge surge!", score: 500 },
        { title: "Very bullish ETF approval news today", score: 300 },
        { title: "Massive pump across the board", score: 200 },
      ]),
      [],
    );
    expect(result?.sentiment.overall).toBe("BULLISH");
  });

  it("should return BEARISH when posts have bearish keywords", () => {
    const result = SENTIMENT_ANALYST_DEFINITION.buildDeterministicOutput!(
      makeToolData(50, [
        { title: "BTC crash imminent sell everything now", score: 800 },
        { title: "This is a bearish market, major dump coming", score: 600 },
        { title: "Crypto ban in major country terrible news", score: 400 },
      ]),
      [],
    );
    expect(result?.sentiment.overall).toBe("BEARISH");
  });

  it("should return NEUTRAL when posts are mixed", () => {
    const result = SENTIMENT_ANALYST_DEFINITION.buildDeterministicOutput!(
      makeToolData(50, [
        { title: "BTC rally?", score: 100 },
        { title: "Market crash incoming?", score: 100 },
      ]),
      [],
    );
    expect(result?.sentiment.overall).toBe("NEUTRAL");
  });
});
