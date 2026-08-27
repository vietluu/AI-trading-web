import { describe, expect, it } from "vitest";
import {
  NewsAgentOutputSchema,
  NewsSentimentInputSchema,
  SentimentAgentOutputSchema,
} from "@platform/shared";
import {
  classifyNewsImpact,
  mapSentimentScore,
} from "../../src/modules/agents/domain/analysis/news-sentiment-mapper";
import {
  NEWS_ANALYST_ALLOWED_TOOLS,
  NEWS_ANALYST_DEFINITION,
} from "../../src/modules/agents/domain/definitions/news-analyst.definition";
import {
  SENTIMENT_ANALYST_ALLOWED_TOOLS,
  SENTIMENT_ANALYST_DEFINITION,
} from "../../src/modules/agents/domain/definitions/sentiment-analyst.definition";
import {
  AgentContextSection,
  AgentType,
} from "../../src/modules/agents/domain/enums";
import { PromptRegistry } from "../../src/modules/ai/infrastructure/prompt/prompt-registry";

describe("News and Sentiment Analyst Agents", () => {
  it("defaults and bounds the shared input", () => {
    expect(NewsSentimentInputSchema.parse({ symbol: "BTC" })).toEqual({
      symbol: "BTC",
      lookbackHours: 6,
      maxItems: 20,
    });
    expect(
      NewsSentimentInputSchema.safeParse({ lookbackHours: 25 }).success,
    ).toBe(false);
    expect(NewsSentimentInputSchema.safeParse({ maxItems: 51 }).success).toBe(
      false,
    );
  });

  it("classifies news importance deterministically", () => {
    expect(classifyNewsImpact(80)).toBe("HIGH");
    expect(classifyNewsImpact(79)).toBe("MEDIUM");
    expect(classifyNewsImpact(50)).toBe("MEDIUM");
    expect(classifyNewsImpact(49)).toBe("LOW");
  });

  it("maps fear and greed scores into sentiment and intensity", () => {
    expect(mapSentimentScore(90)).toEqual({
      overall: "BULLISH",
      intensity: "HIGH",
    });
    expect(mapSentimentScore(68)).toEqual({
      overall: "BULLISH",
      intensity: "MEDIUM",
    });
    expect(mapSentimentScore(50)).toEqual({
      overall: "NEUTRAL",
      intensity: "LOW",
    });
    expect(mapSentimentScore(12)).toEqual({
      overall: "BEARISH",
      intensity: "HIGH",
    });
  });

  it("strictly validates both output schemas", () => {
    const generatedAt = new Date().toISOString();
    const news = {
      summary:
        "ETF and regulatory developments dominate the current narrative.",
      impact: { level: "HIGH", direction: "POSITIVE" },
      keyEvents: [
        { title: "ETF options expanded", impact: "POSITIVE", importance: 85 },
      ],
      themes: ["ETF", "regulation"],
      riskSignals: [],
      dataQuality: "GOOD",
      usedTools: [...NEWS_ANALYST_ALLOWED_TOOLS].slice(0, 2),
      generatedAt,
    } as const;
    const sentiment = {
      summary: "Optimism is elevated without evidence of panic.",
      sentiment: { overall: "BULLISH", intensity: "MEDIUM" },
      crowdBehavior: { fomo: false, panic: false, euphoria: false },
      sources: { social: "Reddit", marketSentimentIndex: "68 - Greed" },
      anomalies: [],
      dataQuality: "GOOD",
      usedTools: [...SENTIMENT_ANALYST_ALLOWED_TOOLS],
      generatedAt,
    } as const;

    expect(NewsAgentOutputSchema.safeParse(news).success).toBe(true);
    expect(SentimentAgentOutputSchema.safeParse(sentiment).success).toBe(true);
    expect(
      NewsAgentOutputSchema.safeParse({ ...news, signal: "LONG" }).success,
    ).toBe(false);
    expect(
      SentimentAgentOutputSchema.safeParse({ ...sentiment, entry: "100000" })
        .success,
    ).toBe(false);
  });

  it("restricts tools, capabilities, context, age, and rounds", () => {
    expect(NEWS_ANALYST_DEFINITION.type).toBe(AgentType.NEWS_ANALYST);
    expect(NEWS_ANALYST_DEFINITION.allowedToolNames).toEqual([
      ...NEWS_ANALYST_ALLOWED_TOOLS,
    ]);
    expect(NEWS_ANALYST_DEFINITION.requiredCapabilities).toEqual(["READ_NEWS"]);
    expect(NEWS_ANALYST_DEFINITION.contextPolicy.allowedSections).toEqual([
      AgentContextSection.NEWS,
    ]);
    expect(
      NEWS_ANALYST_DEFINITION.contextPolicy.maximumAgeSecondsBySection.NEWS,
    ).toBe(43_200);
    expect(NEWS_ANALYST_DEFINITION.maxToolRounds).toBe(2);

    expect(SENTIMENT_ANALYST_DEFINITION.type).toBe(AgentType.SENTIMENT_ANALYST);
    expect(SENTIMENT_ANALYST_DEFINITION.allowedToolNames).toEqual([
      ...SENTIMENT_ANALYST_ALLOWED_TOOLS,
    ]);
    expect(SENTIMENT_ANALYST_DEFINITION.requiredCapabilities).toEqual([
      "READ_SENTIMENT",
      "READ_SOCIAL",
    ]);
    expect(SENTIMENT_ANALYST_DEFINITION.contextPolicy.allowedSections).toEqual([
      AgentContextSection.SENTIMENT,
      AgentContextSection.SOCIAL,
    ]);
    expect(SENTIMENT_ANALYST_DEFINITION.maxToolRounds).toBe(2);
    expect(
      SENTIMENT_ANALYST_DEFINITION.allowedToolNames.some((name) =>
        name.startsWith("market."),
      ),
    ).toBe(false);
  });

  it("registers structured non-trading prompts", () => {
    const registry = new PromptRegistry();
    const news = registry.getVersion("news_analyst_v1", 1);
    const sentiment = registry.getVersion("sentiment_analyst_v1", 1);
    expect(news?.userTemplate).toBe("Analyze recent news affecting {{symbol}}");
    expect(sentiment?.userTemplate).toBe(
      "Analyze current market sentiment for {{symbol}}",
    );
    expect(news?.systemTemplate).toContain(
      "Never output LONG, SHORT, BUY, or SELL",
    );
    expect(sentiment?.systemTemplate).toContain(
      "Never output LONG, SHORT, BUY, or SELL",
    );
  });

  it("builds useful news output without spending an AI provider call", () => {
    const output = NEWS_ANALYST_DEFINITION.buildDeterministicOutput?.(
      {
        "news.articles.list": {
          articles: [
            {
              id: "n1",
              title: "ETF approval drives institutional inflow",
              importance: 90,
              topics: ["ETF"],
              kind: "NEWS_ARTICLE",
              symbols: ["BTC"],
              sourceId: "source-1",
              corroboratingSourceIds: ["source-1", "source-2", "source-3"],
            },
          ],
        },
      },
      ["news.articles.list"],
    );

    expect(NewsAgentOutputSchema.safeParse(output).success).toBe(true);
    expect(output?.impact).toEqual({ level: "HIGH", direction: "POSITIVE" });
    expect(output?.dataQuality).toBe("GOOD");
  });

  it("raises a corroborated systemic policy cluster to high impact", () => {
    const articles = [
      ["n1", "Trump pushes Congress to pass CLARITY Act", 70],
      ["n2", "White House crypto event urges Senate action", 70],
      ["n3", "Trump teases more Bitcoin buys after crypto meeting", 70],
      ["n4", "CFTC crypto access discussed at Trump White House event", 70],
    ].map(([id, title, importance], index) => ({
      id, title, importance, topics: ["regulation"], kind: "MARKET_WIDE_NEWS",
      relevance: "MARKET_WIDE_CONTEXT", sourceId: `source-${index + 1}`,
      corroboratingSourceIds: [`source-${index + 1}`],
    }));
    const output = NEWS_ANALYST_DEFINITION.buildDeterministicOutput?.(
      { "news.articles.list": { articles } },
      ["news.articles.list"],
    );

    expect(output?.impact.level).toBe("HIGH");
    expect(output?.impact.direction).toBe("POSITIVE");
  });

  it('keeps a single broad market headline neutral for an unrelated asset', () => {
    const output = NEWS_ANALYST_DEFINITION.buildDeterministicOutput?.({
      'news.articles.list': { articles: [{
        id: 'n1', title: 'U.S. banks launch nationwide blockchain network',
        importance: 75, topics: ['institutional_adoption'], kind: 'MARKET_WIDE_NEWS',
        relevance: 'MARKET_WIDE_CONTEXT', sourceId: 'source-1', symbols: [],
      }] },
    }, ['news.articles.list']);

    expect(output?.impact.direction).toBe('NEUTRAL');
    expect(output?.riskSignals).toEqual([]);
  });

  it("uses current Fear and Greed as partial context when social coverage is empty", () => {
    const output = SENTIMENT_ANALYST_DEFINITION.buildDeterministicOutput?.(
      {
        "sentiment.market.get": {
          dataAvailable: true,
          score: 20,
          classification: "Extreme Fear",
        },
        "social.posts.list": { posts: [] },
      },
      ["sentiment.market.get", "social.posts.list"],
    );

    expect(SentimentAgentOutputSchema.safeParse(output).success).toBe(true);
    expect(output?.sentiment).toEqual({
      overall: "BEARISH",
      intensity: "HIGH",
    });
    expect(output?.dataQuality).toBe("PARTIAL");
  });
});
