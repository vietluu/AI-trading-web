import {
  MarketAgentInputSchema,
  MarketAgentOutputSchema,
  type MarketAgentInput,
  type MarketAgentOutput,
} from '@platform/shared';
import type { AgentDefinition } from '../models/agent-definition.model';
import {
  AgentContextSection,
  AgentExecutionMode,
  AgentMemoryMode,
  AgentStatus,
  AgentType,
} from '../enums';

export const MARKET_ANALYST_ALLOWED_TOOLS = [
  'market.ticker.get',
  'market.candles.list',
  'market.indicators.get',
  'market.funding.get',
  'market.open_interest.get',
  'market.order_book.get',
] as const;

export const MARKET_ANALYST_DEFINITION: AgentDefinition<
  MarketAgentInput,
  MarketAgentOutput
> = {
  type: AgentType.MARKET_ANALYST,
  version: 1,
  displayName: 'Market Analyst Agent',
  description:
    'Analyzes current market structure, volatility, liquidity and derivatives metrics for crypto futures.',
  status: AgentStatus.ACTIVE,
  executionMode: AgentExecutionMode.SYNCHRONOUS,
  inputSchema: MarketAgentInputSchema,
  outputSchema: MarketAgentOutputSchema,
  promptId: 'market_analyst_v1',
  promptVersion: 1,
  allowedToolNames: [...MARKET_ANALYST_ALLOWED_TOOLS],
  requiredCapabilities: ['READ_MARKET_DATA', 'READ_INDICATORS'],
  memoryPolicy: {
    mode: AgentMemoryMode.NONE,
    readTypes: [],
    writeTypes: [],
    maxItems: 0,
    persistFinalOutput: false,
  },
  contextPolicy: {
    allowedSections: [
      AgentContextSection.MARKET_CANDLES,
      AgentContextSection.MARKET_INDICATORS,
      AgentContextSection.MARKET_TICKER,
      AgentContextSection.MARKET_FUNDING,
      AgentContextSection.MARKET_OPEN_INTEREST,
    ],
    requiredSections: [],
    maximumAgeSecondsBySection: {
      [AgentContextSection.MARKET_CANDLES]: 300,
      [AgentContextSection.MARKET_TICKER]: 10,
    },
    maxItemsBySection: {
      [AgentContextSection.MARKET_CANDLES]: 500,
    },
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
    fallbackProviders: ['ANTHROPIC', 'GEMINI', 'OLLAMA'],
    supportsStreaming: false,
  },
  retryPolicy: {
    maxRetries: 2,
    baseDelayMs: 500,
    maxDelayMs: 5_000,
    retryableErrorCodes: ['AGENT_PROVIDER_UNAVAILABLE', 'AGENT_TIMEOUT'],
  },
  timeoutMs: 60_000,
  maxToolRounds: 3,
  maxToolCalls: 6,
  maxInputTokens: 10_000,
  maxOutputTokens: 2_000,
  requiresUserContext: false,
  allowsPublicSystemRun: true,
  buildToolCalls: (input) => [
    {
      toolName: 'market.ticker.get',
      arguments: { symbol: input.symbol, provider: input.provider },
    },
    {
      toolName: 'market.candles.list',
      arguments: {
        symbol: input.symbol,
        provider: input.provider,
        interval: input.interval,
        limit: input.lookbackCandles,
      },
    },
    {
      toolName: 'market.indicators.get',
      arguments: {
        symbol: input.symbol,
        provider: input.provider,
        interval: input.interval,
      },
    },
    {
      toolName: 'market.funding.get',
      arguments: { symbol: input.symbol, provider: input.provider },
    },
    {
      toolName: 'market.open_interest.get',
      arguments: { symbol: input.symbol, provider: input.provider },
    },
    {
      toolName: 'market.order_book.get',
      arguments: { symbol: input.symbol, provider: input.provider, depth: 20 },
    },
  ],
  buildInsufficientOutput: (usedTools, reason) => ({
    summary: `Market analysis could not be completed reliably: ${reason}`,
    trend: { direction: 'SIDEWAYS', strength: 'WEAK' },
    volatility: { level: 'MEDIUM' },
    liquidity: {},
    derivatives: {},
    anomalies: ['Insufficient current market data for reliable analysis.'],
    dataQuality: 'INSUFFICIENT',
    usedTools: usedTools.filter((tool): tool is (typeof MARKET_ANALYST_ALLOWED_TOOLS)[number] =>
      MARKET_ANALYST_ALLOWED_TOOLS.includes(
        tool as (typeof MARKET_ANALYST_ALLOWED_TOOLS)[number],
      ),
    ),
    generatedAt: new Date().toISOString(),
  }),
};
