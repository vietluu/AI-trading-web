import {
  NewsSentimentInputSchema,
  SentimentAgentOutputSchema,
  type NewsSentimentInput,
  type SentimentAgentOutput,
} from "@platform/shared";
import type { AgentDefinition } from "../models/agent-definition.model";
import {
  AgentContextSection,
  AgentExecutionMode,
  AgentMemoryMode,
  AgentStatus,
  AgentType,
} from "../enums";

export const SENTIMENT_ANALYST_ALLOWED_TOOLS = [
  "sentiment.market.get",
  "social.posts.list",
] as const;

function deterministicSentiment(
  toolData: Readonly<Record<string, unknown>>,
  usedTools: string[],
): SentimentAgentOutput {
  const market = toolData["sentiment.market.get"] as
    Record<string, unknown> | undefined;
  const social = toolData["social.posts.list"] as
    Record<string, unknown> | undefined;
  const score = Number(market?.score);
  const hasIndex = market?.dataAvailable === true && Number.isFinite(score);
  const posts = Array.isArray(social?.posts) ? social.posts : [];
  if (!hasIndex && posts.length === 0) {
    return {
      summary:
        "Neither a current market sentiment index nor social observations were available.",
      sentiment: { overall: "NEUTRAL", intensity: "LOW" },
      crowdBehavior: { fomo: false, panic: false, euphoria: false },
      sources: {},
      anomalies: ["Sentiment coverage is unavailable."],
      dataQuality: "INSUFFICIENT",
      usedTools: usedTools as SentimentAgentOutput["usedTools"],
      generatedAt: new Date().toISOString(),
    };
  }
  const overall = hasIndex
    ? score <= 35
      ? ("BEARISH" as const)
      : score >= 65
        ? ("BULLISH" as const)
        : ("NEUTRAL" as const)
    : ("NEUTRAL" as const);
  const classification =
    typeof market?.classification === "string"
      ? market.classification
      : overall;
  const intensity =
    hasIndex && (score <= 20 || score >= 80)
      ? ("HIGH" as const)
      : hasIndex && (score <= 35 || score >= 65)
        ? ("MEDIUM" as const)
        : ("LOW" as const);
  return {
    summary: `Global Fear & Greed${hasIndex ? ` is ${score} (${classification})` : " is unavailable"}; ${posts.length} recent social post(s) were available.`,
    sentiment: { overall, intensity },
    crowdBehavior: {
      fomo: hasIndex && score >= 75,
      panic: hasIndex && score <= 25,
      euphoria: hasIndex && score >= 85,
    },
    sources: {
      ...(posts.length > 0
        ? { social: `${posts.length} recent social posts` }
        : {}),
      ...(hasIndex
        ? {
            marketSentimentIndex: `${score} ${classification}`.trim(),
          }
        : {}),
    },
    anomalies:
      posts.length === 0
        ? [
            "No asset-specific social observations; global index is context only.",
          ]
        : [],
    dataQuality: hasIndex && posts.length > 0 ? "GOOD" : "PARTIAL",
    usedTools: usedTools as SentimentAgentOutput["usedTools"],
    generatedAt: new Date().toISOString(),
  };
}

export const SENTIMENT_ANALYST_DEFINITION: AgentDefinition<
  NewsSentimentInput,
  SentimentAgentOutput
> = {
  type: AgentType.SENTIMENT_ANALYST,
  version: 1,
  displayName: "Sentiment Analyst Agent",
  description: "Analyzes social sentiment and crowd psychology.",
  status: AgentStatus.ACTIVE,
  executionMode: AgentExecutionMode.SYNCHRONOUS,
  inputSchema: NewsSentimentInputSchema,
  outputSchema: SentimentAgentOutputSchema,
  promptId: "sentiment_analyst_v1",
  promptVersion: 1,
  allowedToolNames: [...SENTIMENT_ANALYST_ALLOWED_TOOLS],
  requiredCapabilities: ["READ_SENTIMENT", "READ_SOCIAL"],
  memoryPolicy: {
    mode: AgentMemoryMode.NONE,
    readTypes: [],
    writeTypes: [],
    maxItems: 0,
    persistFinalOutput: false,
  },
  contextPolicy: {
    allowedSections: [
      AgentContextSection.SENTIMENT,
      AgentContextSection.SOCIAL,
    ],
    requiredSections: [],
    maximumAgeSecondsBySection: {
      [AgentContextSection.SENTIMENT]: 6 * 60 * 60,
      [AgentContextSection.SOCIAL]: 6 * 60 * 60,
    },
    maxItemsBySection: { [AgentContextSection.SOCIAL]: 50 },
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
      toolName: "sentiment.market.get",
      arguments: { symbol: input.symbol, lookbackHours: input.lookbackHours },
    },
    {
      toolName: "social.posts.list",
      arguments: {
        symbol: input.symbol,
        lookbackHours: input.lookbackHours,
        limit: input.maxItems,
      },
    },
  ],
  buildDeterministicOutput: deterministicSentiment,
  buildInsufficientOutput: (usedTools, reason) => ({
    summary: `Sentiment analysis could not be completed reliably: ${reason}`,
    sentiment: { overall: "NEUTRAL", intensity: "LOW" },
    crowdBehavior: { fomo: false, panic: false, euphoria: false },
    sources: {},
    anomalies: ["Insufficient current sentiment data for reliable analysis."],
    dataQuality: "INSUFFICIENT",
    usedTools: usedTools.filter(
      (tool): tool is (typeof SENTIMENT_ANALYST_ALLOWED_TOOLS)[number] =>
        SENTIMENT_ANALYST_ALLOWED_TOOLS.includes(
          tool as (typeof SENTIMENT_ANALYST_ALLOWED_TOOLS)[number],
        ),
    ),
    generatedAt: new Date().toISOString(),
  }),
};
