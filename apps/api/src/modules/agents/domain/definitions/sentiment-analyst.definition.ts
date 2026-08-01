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
