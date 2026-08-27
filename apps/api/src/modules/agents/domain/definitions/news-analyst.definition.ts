import {
  NewsAgentOutputSchema,
  NewsSentimentInputSchema,
  type NewsAgentOutput,
  type NewsSentimentInput,
} from "@platform/shared";
import type { AgentDefinition } from "../models/agent-definition.model";
import {
  AgentContextSection,
  AgentExecutionMode,
  AgentMemoryMode,
  AgentStatus,
  AgentType,
} from "../enums";

export const NEWS_ANALYST_ALLOWED_TOOLS = [
  "news.articles.list",
  "news.article.get",
  "news.high_importance.list",
] as const;

function deterministicNews(
  toolData: Readonly<Record<string, unknown>>,
  usedTools: string[],
): NewsAgentOutput {
  const articles: unknown[] = [];
  for (const value of Object.values(toolData)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const rows = (value as Record<string, unknown>).articles;
    if (Array.isArray(rows)) articles.push(...(rows as unknown[]));
  }
  const records = articles.filter((value): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value)),
  );
  const safeText = (value: unknown, fallback = "") =>
    typeof value === "string" || typeof value === "number"
      ? String(value)
      : fallback;
  const unique = [
    ...new Map(
      records.map((item) => [
        safeText(item.id, safeText(item.url, JSON.stringify(item))),
        item,
      ]),
    ).values(),
  ];
  const positive =
    /surge|rally|approv(?:al|es?|ed)|adoption|upgrade|inflow|partnership|record|teases? more (?:bitcoin|crypto) buys?|working to bring|push(?:es)? (?:congress|senate).*pass|urges? (?:congress|senate).*pass/i;
  const negative =
    /hack|exploit|lawsuit|ban(?:s|ned)?|outflow|liquidation|delist|crash|breach|reject(?:s|ed|ion)?|charges? .*fraud/i;
  const eventKey = (item: Record<string, unknown>): string | undefined => {
    const text = `${safeText(item.title)} ${safeText(item.summary)}`;
    if (/trump|white house/i.test(text) && /crypto|bitcoin|clarity act|cftc/i.test(text)) return "US_CRYPTO_POLICY";
    if (/\betf\b/i.test(text)) return "ETF";
    if (/\bfed\b|fomc|interest rate/i.test(text)) return "MONETARY_POLICY";
    if (/hack|exploit|security breach/i.test(text)) return "SECURITY_INCIDENT";
    return undefined;
  };
  const sourceIds = (item: Record<string, unknown>): string[] => {
    const corroborating = Array.isArray(item.corroboratingSourceIds)
      ? item.corroboratingSourceIds.filter((value): value is string => typeof value === "string")
      : [];
    const sourceId = safeText(item.sourceId);
    return [...new Set([...(sourceId ? [sourceId] : []), ...corroborating])];
  };
  const clusterSources = new Map<string, Set<string>>();
  for (const item of unique) {
    const key = eventKey(item);
    if (!key) continue;
    const sources = clusterSources.get(key) ?? new Set<string>();
    sourceIds(item).forEach((source) => sources.add(source));
    clusterSources.set(key, sources);
  }
  const scored = unique
    .map((item) => {
      const text = `${safeText(item.title)} ${safeText(item.summary)}`;
      const rawDirection = negative.test(text)
        ? ("NEGATIVE" as const)
        : positive.test(text)
          ? ("POSITIVE" as const)
          : ("NEUTRAL" as const);
      const key = eventKey(item);
      const independentSources = key ? clusterSources.get(key)?.size ?? 0 : 0;
      const symbols = Array.isArray(item.symbols)
        ? item.symbols.filter((value): value is string => typeof value === "string")
        : [];
      const directlyRelevant = item.kind === "EXCHANGE_ANNOUNCEMENT" ||
        (item.relevance !== "MARKET_WIDE_CONTEXT" && symbols.length > 0);
      const corroboratedSystemic = item.relevance === "MARKET_WIDE_CONTEXT" &&
        Boolean(key) && independentSources >= 2;
      // Broad finance/regulatory headlines are useful context but may not
      // manufacture an asset direction without direct relevance or independent
      // corroboration of a genuinely systemic crypto event.
      const direction = directlyRelevant || corroboratedSystemic
        ? rawDirection
        : ("NEUTRAL" as const);
      const corroborationBonus = key
        ? Math.min(Math.max(independentSources - 1, 0) * 5, 20)
        : 0;
      return {
        item,
        direction,
        importance: Math.min(100, Number(item.importance ?? 0) + corroborationBonus),
      };
    })
    .sort((a, b) => b.importance - a.importance);
  if (scored.length === 0) {
    return {
      summary:
        "No recent trusted asset-specific or market-wide news was available.",
      impact: { level: "LOW", direction: "NEUTRAL" },
      keyEvents: [],
      themes: [],
      riskSignals: ["News coverage is currently sparse."],
      dataQuality: "INSUFFICIENT",
      usedTools: usedTools as NewsAgentOutput["usedTools"],
      generatedAt: new Date().toISOString(),
    };
  }
  const top = scored.slice(0, 5);
  const directional = top.filter((item) => item.direction !== "NEUTRAL");
  const direction =
    directional.length === 0
      ? ("NEUTRAL" as const)
      : directional.filter((item) => item.direction === "POSITIVE").length >=
          directional.filter((item) => item.direction === "NEGATIVE").length
        ? ("POSITIVE" as const)
        : ("NEGATIVE" as const);
  const maximumImportance = Math.max(...top.map((item) => item.importance));
  const trustedSourceCount = new Set(unique.flatMap(sourceIds)).size;
  return {
    summary: `${unique.length} trusted recent article(s) from ${trustedSourceCount} independent source(s) were evaluated deterministically; verified market impact is ${direction.toLowerCase()}.`,
    impact: {
      level:
        maximumImportance >= 85
          ? "HIGH"
          : maximumImportance >= 65
            ? "MEDIUM"
            : "LOW",
      direction,
    },
    keyEvents: top.map(({ item, direction: eventDirection, importance }) => ({
      title: safeText(item.title, "Untitled market event"),
      impact: eventDirection,
      importance: Math.max(0, Math.min(100, importance)),
    })),
    themes: [
      ...new Set(
        top.flatMap(({ item }) =>
          Array.isArray(item.topics)
            ? item.topics.map((topic) => safeText(topic)).filter(Boolean)
            : [],
        ),
      ),
    ].slice(0, 8),
    riskSignals: top
      .filter((item) => item.direction === "NEGATIVE")
      .map(({ item }) => safeText(item.title, "Negative market event")),
    dataQuality: trustedSourceCount >= 3 ? "GOOD" : "PARTIAL",
    usedTools: usedTools as NewsAgentOutput["usedTools"],
    generatedAt: new Date().toISOString(),
  };
}

export const NEWS_ANALYST_DEFINITION: AgentDefinition<
  NewsSentimentInput,
  NewsAgentOutput
> = {
  type: AgentType.NEWS_ANALYST,
  version: 1,
  displayName: "News Analyst Agent",
  description:
    "Analyzes recent news and evaluates its potential market impact.",
  status: AgentStatus.ACTIVE,
  executionMode: AgentExecutionMode.SYNCHRONOUS,
  inputSchema: NewsSentimentInputSchema,
  outputSchema: NewsAgentOutputSchema,
  promptId: "news_analyst_v1",
  promptVersion: 1,
  allowedToolNames: [...NEWS_ANALYST_ALLOWED_TOOLS],
  requiredCapabilities: ["READ_NEWS"],
  memoryPolicy: {
    mode: AgentMemoryMode.NONE,
    readTypes: [],
    writeTypes: [],
    maxItems: 0,
    persistFinalOutput: false,
  },
  contextPolicy: {
    allowedSections: [AgentContextSection.NEWS],
    requiredSections: [],
    maximumAgeSecondsBySection: { [AgentContextSection.NEWS]: 12 * 60 * 60 },
    maxItemsBySection: { [AgentContextSection.NEWS]: 50 },
    includeUserSettings: false,
    includeOpenPositions: false,
    includeMemory: false,
    includePreviousAgentResults: false,
  },
  modelPolicy: {
    requiresToolCalling: true,
    requiresStructuredOutput: true,
    defaultTemperature: 0,
    maximumTemperature: 0,
    fallbackProviders: ["ANTHROPIC", "GEMINI", "OLLAMA"],
    supportsStreaming: false,
  },
  retryPolicy: {
    maxRetries: 2,
    baseDelayMs: 500,
    maxDelayMs: 5_000,
    retryableErrorCodes: ["AGENT_PROVIDER_UNAVAILABLE", "AGENT_TIMEOUT"],
  },
  timeoutMs: 60_000,
  maxToolRounds: 2,
  maxToolCalls: 2,
  maxInputTokens: 10_000,
  maxOutputTokens: 2_000,
  requiresUserContext: false,
  allowsPublicSystemRun: true,
  includeUsedToolsInOutput: true,
  buildToolCalls: (input) => [
    {
      toolName: "news.articles.list",
      arguments: {
        symbol: input.symbol,
        lookbackHours: input.lookbackHours,
        limit: input.maxItems,
      },
    },
    {
      toolName: "news.high_importance.list",
      arguments: {
        symbol: input.symbol,
        lookbackHours: input.lookbackHours,
        limit: input.maxItems,
        minimumImportance: 70,
      },
    },
  ],
  buildDeterministicOutput: deterministicNews,
  buildInsufficientOutput: (usedTools, reason) => ({
    summary: `News analysis could not be completed reliably: ${reason}`,
    impact: { level: "LOW", direction: "NEUTRAL" },
    keyEvents: [],
    themes: [],
    riskSignals: ["Insufficient recent news data for reliable analysis."],
    dataQuality: "INSUFFICIENT",
    usedTools: usedTools.filter(
      (tool): tool is (typeof NEWS_ANALYST_ALLOWED_TOOLS)[number] =>
        NEWS_ANALYST_ALLOWED_TOOLS.includes(
          tool as (typeof NEWS_ANALYST_ALLOWED_TOOLS)[number],
        ),
    ),
    generatedAt: new Date().toISOString(),
  }),
};
