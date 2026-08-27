import { describe, expect, it, vi } from "vitest";
import {
  FusionOutputSchema,
  MacroAgentInputSchema,
  MacroAgentOutputSchema,
  OnChainAgentOutputSchema,
  type FusionInput,
} from "@platform/shared";
import { FusionService } from "../../src/modules/agents/application/services/fusion.service";
import { MACRO_ANALYST_DEFINITION } from "../../src/modules/agents/domain/definitions/macro-analyst.definition";
import { ON_CHAIN_ANALYST_DEFINITION } from "../../src/modules/agents/domain/definitions/on-chain-analyst.definition";
import {
  AgentContextSection,
  AgentInvocationSource,
  AgentStatus,
  AgentType,
} from "../../src/modules/agents/domain/enums";
import { PromptRegistry } from "../../src/modules/ai/infrastructure/prompt/prompt-registry";

function analysisFixture(): FusionInput {
  const generatedAt = new Date().toISOString();
  return {
    market: {
      summary: "Price structure is rising.",
      trend: { direction: "UP", strength: "MODERATE" },
      volatility: { level: "MEDIUM" },
      liquidity: { depthImbalance: "BALANCED" },
      derivatives: {},
      anomalies: [],
      dataQuality: "GOOD",
      usedTools: ["market.ticker.get"],
      generatedAt,
    },
    technical: {
      summary: "Momentum and structure are constructive.",
      trend: { direction: "UP", strength: "MODERATE" },
      momentum: {
        rsi: "58",
        rsiState: "NEUTRAL",
        macd: { trend: "BULLISH" },
      },
      movingAverages: { alignment: "BULLISH", pricePosition: "ABOVE" },
      volatility: { bollinger: { position: "MIDDLE", squeeze: false } },
      structure: { marketStructure: "HH_HL" },
      divergence: {},
      signals: ["Higher-high structure remains intact."],
      dataQuality: "GOOD",
      usedTools: ["market.indicators.get"],
      generatedAt,
    },
    news: {
      summary: "Recent news impact is positive.",
      impact: { level: "MEDIUM", direction: "POSITIVE" },
      keyEvents: [],
      themes: ["institutional"],
      riskSignals: [],
      dataQuality: "GOOD",
      usedTools: ["news.articles.list"],
      generatedAt,
    },
    sentiment: {
      summary: "Crowd sentiment is optimistic.",
      sentiment: { overall: "BULLISH", intensity: "MEDIUM" },
      crowdBehavior: { fomo: false, panic: false, euphoria: false },
      sources: { marketSentimentIndex: "62" },
      anomalies: [],
      dataQuality: "GOOD",
      usedTools: ["sentiment.market.get"],
      generatedAt,
    },
    macro: {
      summary: "Restrictive policy remains a macro headwind.",
      macroTrend: "RISK_OFF",
      keyEvents: ["Policy rate held unchanged."],
      riskFactors: ["Liquidity remains restrictive."],
      dataQuality: "GOOD",
      generatedAt,
    },
    onchain: {
      summary: "Exchange inflows are rising.",
      activity: "HIGH",
      flows: { exchangeInflow: "Inflow is rising" },
      signals: ["Distribution pressure is elevated."],
      dataQuality: "GOOD",
      generatedAt,
    },
  };
}

describe("Macro and On-chain Analyst Agents", () => {
  it("defines bounded inputs and strict outputs", () => {
    expect(MacroAgentInputSchema.parse({})).toEqual({ lookbackHours: 24 });
    expect(
      MacroAgentInputSchema.safeParse({ lookbackHours: 721 }).success,
    ).toBe(false);
    expect(
      MacroAgentOutputSchema.safeParse(analysisFixture().macro).success,
    ).toBe(true);
    expect(
      OnChainAgentOutputSchema.safeParse(analysisFixture().onchain).success,
    ).toBe(true);
    expect(
      MacroAgentOutputSchema.safeParse({
        ...analysisFixture().macro,
        decision: "LONG",
      }).success,
    ).toBe(false);
  });

  it("restricts macro execution to its event tool", () => {
    expect(MACRO_ANALYST_DEFINITION.type).toBe(AgentType.MACRO_ANALYST);
    expect(MACRO_ANALYST_DEFINITION.allowedToolNames).toEqual([
      "macro.events.list",
    ]);
    expect(MACRO_ANALYST_DEFINITION.requiredCapabilities).toEqual([
      "READ_MACRO",
    ]);
    expect(MACRO_ANALYST_DEFINITION.contextPolicy.allowedSections).toEqual([
      AgentContextSection.MACRO,
    ]);
    expect(
      MACRO_ANALYST_DEFINITION.buildToolCalls?.({ lookbackHours: 48 }),
    ).toEqual([
      {
        toolName: "macro.events.list",
        arguments: { lookbackHours: 48, limit: 50 },
      },
    ]);
  });

  it("uses a verified on-chain data tool and degrades unsupported assets explicitly", () => {
    expect(ON_CHAIN_ANALYST_DEFINITION.type).toBe(AgentType.ON_CHAIN_ANALYST);
    expect(ON_CHAIN_ANALYST_DEFINITION.status).toBe(AgentStatus.ACTIVE);
    expect(ON_CHAIN_ANALYST_DEFINITION.allowedToolNames).toEqual([
      "onchain.metrics.get",
    ]);
    expect(ON_CHAIN_ANALYST_DEFINITION.requiredCapabilities).toEqual([
      "READ_ONCHAIN_DATA",
    ]);
    expect(
      ON_CHAIN_ANALYST_DEFINITION.buildToolCalls?.({
        symbol: "SUI-USDT",
        lookbackHours: 168,
      }),
    ).toEqual([
      {
        toolName: "onchain.metrics.get",
        arguments: { symbol: "SUI-USDT", lookbackHours: 168 },
      },
    ]);
    const fallback = ON_CHAIN_ANALYST_DEFINITION.buildInsufficientOutput?.(
      [],
      "provider unavailable",
    );
    expect(OnChainAgentOutputSchema.safeParse(fallback).success).toBe(true);
    expect(fallback?.dataQuality).toBe("INSUFFICIENT");
  });

  it("registers non-trading macro and on-chain prompts", () => {
    const registry = new PromptRegistry();
    const macro = registry.getVersion("macro_analyst_v1", 1);
    const onchain = registry.getVersion("on_chain_analyst_v1", 1);
    expect(macro?.systemTemplate).toContain(
      "Never output LONG, SHORT, BUY, or SELL",
    );
    expect(onchain?.systemTemplate).toContain("Coin Metrics");
  });
});

describe("FusionService", () => {
  it("uses majority bias, agreement confidence, conflict logs, and quality", () => {
    const fusion = new FusionService({} as never);
    const output = fusion.fuse(analysisFixture());

    expect(FusionOutputSchema.safeParse(output).success).toBe(true);
    expect(output.overallBias).toBe("BULLISH");
    expect(output.confidence).toBe(67);
    expect(output.dataQuality).toBe("GOOD");
    expect(output.conflicts).toEqual(
      expect.arrayContaining([
        expect.stringContaining("bullish"),
        expect.stringContaining("bearish"),
      ]),
    );
    expect(output.combinedAnalysis.macro).toBe(analysisFixture().macro.summary);
  });

  it("returns neutral when directional agents are evenly mixed", () => {
    const input = analysisFixture();
    input.news.impact.direction = "NEGATIVE";
    const output = new FusionService({} as never).fuse(input);

    expect(output.overallBias).toBe("NEUTRAL");
    expect(output.confidence).toBe(50);
  });

  it("does not penalize fusion quality for an explicitly unconfigured on-chain provider", () => {
    const input = analysisFixture();
    input.onchain = {
      summary: "On-chain data is not yet connected.",
      activity: "NORMAL",
      flows: {},
      signals: [
        "Coin Metrics returned no verified coverage for this asset or was unavailable.",
      ],
      dataQuality: "INSUFFICIENT",
      generatedAt: new Date().toISOString(),
    };
    const output = new FusionService({} as never).fuse(input);

    expect(output.dataQuality).toBe("GOOD");
    expect(output.confidence).toBe(80);
  });

  it("runs all six agents through AgentExecutionService and validates output", async () => {
    const fixture = analysisFixture();
    const outputByType: Partial<Record<AgentType, unknown>> = {
      [AgentType.MARKET_ANALYST]: fixture.market,
      [AgentType.TECHNICAL_ANALYST]: fixture.technical,
      [AgentType.NEWS_ANALYST]: fixture.news,
      [AgentType.SENTIMENT_ANALYST]: fixture.sentiment,
      [AgentType.MACRO_ANALYST]: fixture.macro,
      [AgentType.ON_CHAIN_ANALYST]: fixture.onchain,
    };
    const executeSync = vi
      .fn()
      .mockImplementation(({ agentType }: { agentType: AgentType }) =>
        Promise.resolve({ output: outputByType[agentType] }),
      );
    const service = new FusionService({ executeSync } as never);

    const output = await service.run({
      input: {
        symbol: "BTC-USDT",
        provider: "BINANCE_FUTURES",
        interval: "15m",
        lookbackCandles: 150,
        lookbackHours: 6,
        maxItems: 20,
      },
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
    });

    expect(executeSync).toHaveBeenCalledTimes(6);
    const calledTypes = (
      executeSync.mock.calls as Array<[{ agentType: AgentType }]>
    ).map(([call]) => call.agentType);
    expect(calledTypes).toEqual(
      expect.arrayContaining([
        AgentType.MARKET_ANALYST,
        AgentType.TECHNICAL_ANALYST,
        AgentType.NEWS_ANALYST,
        AgentType.SENTIMENT_ANALYST,
        AgentType.MACRO_ANALYST,
        AgentType.ON_CHAIN_ANALYST,
      ]),
    );
    expect(FusionOutputSchema.safeParse(output).success).toBe(true);
  });

  it("still evaluates secondary evidence while core price action is sideways", async () => {
    const fixture = analysisFixture();
    fixture.market.trend.direction = "SIDEWAYS";
    fixture.technical.trend.direction = "SIDEWAYS";
    const outputByType: Partial<Record<AgentType, unknown>> = {
      [AgentType.MARKET_ANALYST]: fixture.market,
      [AgentType.TECHNICAL_ANALYST]: fixture.technical,
      [AgentType.NEWS_ANALYST]: fixture.news,
      [AgentType.SENTIMENT_ANALYST]: fixture.sentiment,
      [AgentType.MACRO_ANALYST]: fixture.macro,
      [AgentType.ON_CHAIN_ANALYST]: fixture.onchain,
    };
    const executeSync = vi.fn(({ agentType }: { agentType: AgentType }) =>
      Promise.resolve({ output: outputByType[agentType] }),
    );
    const service = new FusionService({ executeSync } as never);

    await service.runDetailed({
      input: {
        symbol: "BTC-USDT",
        provider: "BINANCE_FUTURES",
        interval: "1m",
        lookbackCandles: 150,
        lookbackHours: 6,
        maxItems: 20,
      },
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
    });

    expect(executeSync).toHaveBeenCalledTimes(6);
    expect(executeSync).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: AgentType.NEWS_ANALYST }),
    );
  });

  it("degrades failed agent runs instead of failing the fusion response", async () => {
    const service = new FusionService({
      executeSync: vi.fn().mockRejectedValue(new Error("unavailable")),
    } as never);
    const output = await service.run({
      input: {
        symbol: "ETH-USDT",
        provider: "OKX_FUTURES",
        interval: "1h",
        lookbackCandles: 100,
        lookbackHours: 6,
        maxItems: 10,
      },
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
    });

    expect(output.overallBias).toBe("NEUTRAL");
    expect(output.confidence).toBe(0);
    expect(output.dataQuality).toBe("INSUFFICIENT");
    expect(FusionOutputSchema.safeParse(output).success).toBe(true);
  });

  it("treats verified absence of news as a partial neutral observation", async () => {
    const fixture = analysisFixture();
    const noNews = {
      ...fixture.news,
      summary:
        "No recent news articles or high-importance events were identified.",
      impact: { level: "LOW" as const, direction: "NEUTRAL" as const },
      keyEvents: [],
      riskSignals: [],
      dataQuality: "INSUFFICIENT" as const,
      usedTools: ["news.articles.list", "news.high_importance.list"] as const,
    };
    const outputByType: Partial<Record<AgentType, unknown>> = {
      [AgentType.MARKET_ANALYST]: fixture.market,
      [AgentType.TECHNICAL_ANALYST]: fixture.technical,
      [AgentType.NEWS_ANALYST]: noNews,
      [AgentType.SENTIMENT_ANALYST]: fixture.sentiment,
      [AgentType.MACRO_ANALYST]: fixture.macro,
      [AgentType.ON_CHAIN_ANALYST]: fixture.onchain,
    };
    const service = new FusionService({
      executeSync: vi.fn(({ agentType }: { agentType: AgentType }) =>
        Promise.resolve({ output: outputByType[agentType] }),
      ),
    } as never);

    const result = await service.runDetailed({
      input: {
        symbol: "OKB-USDT",
        provider: "OKX_FUTURES",
        interval: "15m",
        lookbackCandles: 100,
        lookbackHours: 24,
        maxItems: 20,
      },
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
    });

    expect(result.analyses.news.dataQuality).toBe("PARTIAL");
    expect(result.analyses.news.impact.direction).toBe("NEUTRAL");
  });

  it("omits Macro without imported evidence instead of calling a synthetic analyst", async () => {
    const fixture = analysisFixture();
    const outputByType: Partial<Record<AgentType, unknown>> = {
      [AgentType.MARKET_ANALYST]: fixture.market,
      [AgentType.TECHNICAL_ANALYST]: fixture.technical,
      [AgentType.NEWS_ANALYST]: fixture.news,
      [AgentType.SENTIMENT_ANALYST]: fixture.sentiment,
      [AgentType.ON_CHAIN_ANALYST]: fixture.onchain,
    };
    const executeSync = vi.fn(({ agentType }: { agentType: AgentType }) =>
      Promise.resolve({ output: outputByType[agentType] }),
    );
    const service = new FusionService({ executeSync } as never, undefined, {
      macroEconomicEvent: { count: vi.fn().mockResolvedValue(0) },
    } as never);

    const result = await service.runDetailed({
      input: {
        symbol: "OKB-USDT",
        provider: "OKX_FUTURES",
        interval: "15m",
        lookbackCandles: 100,
        lookbackHours: 24,
        maxItems: 20,
      },
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
    });

    expect(result.analyses.macro.dataQuality).toBe("INSUFFICIENT");
    expect(result.analyses.macro.summary).toMatch(
      /no official or imported macro event/i,
    );
    expect(executeSync).toHaveBeenCalledTimes(5);
    expect(executeSync).not.toHaveBeenCalledWith(
      expect.objectContaining({ agentType: AgentType.MACRO_ANALYST }),
    );
  });

  it("coalesces concurrent analysis for the same symbol snapshot", async () => {
    const fixture = analysisFixture();
    const outputByType: Partial<Record<AgentType, unknown>> = {
      [AgentType.MARKET_ANALYST]: fixture.market,
      [AgentType.TECHNICAL_ANALYST]: fixture.technical,
      [AgentType.NEWS_ANALYST]: fixture.news,
      [AgentType.SENTIMENT_ANALYST]: fixture.sentiment,
      [AgentType.MACRO_ANALYST]: fixture.macro,
      [AgentType.ON_CHAIN_ANALYST]: fixture.onchain,
    };
    const executeSync = vi
      .fn()
      .mockImplementation(async ({ agentType }: { agentType: AgentType }) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { output: outputByType[agentType] };
      });
    const service = new FusionService({ executeSync } as never);
    const options = {
      input: {
        symbol: "BTC-USDT",
        provider: "BINANCE_FUTURES" as const,
        interval: "15m" as const,
        lookbackCandles: 150,
        lookbackHours: 6,
        maxItems: 20,
      },
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
    };

    const [first, second] = await Promise.all([
      service.runDetailed(options),
      service.runDetailed(options),
    ]);

    expect(first.analyses).toEqual(second.analyses);
    expect(executeSync).toHaveBeenCalledTimes(6);
  });

  it("uses the Redis lock to coalesce the same snapshot across service instances", async () => {
    const fixture = analysisFixture();
    const outputByType: Partial<Record<AgentType, unknown>> = {
      [AgentType.MARKET_ANALYST]: fixture.market,
      [AgentType.TECHNICAL_ANALYST]: fixture.technical,
      [AgentType.NEWS_ANALYST]: fixture.news,
      [AgentType.SENTIMENT_ANALYST]: fixture.sentiment,
      [AgentType.MACRO_ANALYST]: fixture.macro,
      [AgentType.ON_CHAIN_ANALYST]: fixture.onchain,
    };
    const executeSync = vi
      .fn()
      .mockImplementation(async ({ agentType }: { agentType: AgentType }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { output: outputByType[agentType] };
      });
    const values = new Map<string, string>();
    const locks = new Map<string, string>();
    const redis = {
      get: vi.fn((key: string) =>
        Promise.resolve(values.get(key) ?? locks.get(key) ?? null),
      ),
      setWithTtl: vi.fn((key: string, value: string) => {
        values.set(key, value);
        return Promise.resolve();
      }),
      setNx: vi.fn((key: string, token: string) => {
        if (locks.has(key)) return Promise.resolve(false);
        locks.set(key, token);
        return Promise.resolve(true);
      }),
      compareAndDelete: vi.fn((key: string, token: string) => {
        if (locks.get(key) !== token) return Promise.resolve(false);
        locks.delete(key);
        return Promise.resolve(true);
      }),
    };
    const firstService = new FusionService(
      { executeSync } as never,
      redis as never,
    );
    const secondService = new FusionService(
      { executeSync } as never,
      redis as never,
    );
    const options = {
      input: {
        symbol: "ETH-USDT",
        provider: "OKX_FUTURES" as const,
        interval: "15m" as const,
        lookbackCandles: 150,
        lookbackHours: 6,
        maxItems: 20,
      },
      userId: "user-1",
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
    };

    await Promise.all([
      firstService.runDetailed(options),
      secondService.runDetailed(options),
    ]);

    expect(executeSync).toHaveBeenCalledTimes(6);
    expect(redis.setNx).toHaveBeenCalled();
  });

  it("does not retry any failed agent load while holding its analysis lock", async () => {
    const executeSync = vi.fn().mockRejectedValue(new Error("quota exceeded"));
    const locks = new Map<string, string>();
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      setNx: vi.fn((key: string, token: string) => {
        locks.set(key, token);
        return Promise.resolve(true);
      }),
      compareAndDelete: vi.fn((key: string) => {
        locks.delete(key);
        return Promise.resolve(true);
      }),
      setWithTtl: vi.fn().mockResolvedValue(undefined),
    };
    const service = new FusionService({ executeSync } as never, redis as never);

    const output = await service.run({
      input: {
        symbol: "SOL-USDT",
        provider: "OKX_FUTURES",
        interval: "15m",
        lookbackCandles: 100,
        lookbackHours: 6,
        maxItems: 10,
      },
      userId: "user-1",
      invocationSource: AgentInvocationSource.SYSTEM_TEST,
    });

    expect(output.dataQuality).toBe("INSUFFICIENT");
    expect(executeSync).toHaveBeenCalledTimes(6);
  });
});
