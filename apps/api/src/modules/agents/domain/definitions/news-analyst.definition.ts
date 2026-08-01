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
