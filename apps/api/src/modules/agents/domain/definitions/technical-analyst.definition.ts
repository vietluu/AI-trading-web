import {
  TechnicalAgentInputSchema,
  TechnicalAgentOutputSchema,
  type TechnicalAgentInput,
  type TechnicalAgentOutput,
} from '@platform/shared';
import type { AgentDefinition } from '../models/agent-definition.model';
import {
  AgentContextSection,
  AgentExecutionMode,
  AgentMemoryMode,
  AgentStatus,
  AgentType,
} from '../enums';

export const TECHNICAL_ANALYST_ALLOWED_TOOLS = [
  'market.indicators.get',
  'market.candles.list',
] as const;

export const TECHNICAL_ANALYST_DEFINITION: AgentDefinition<
  TechnicalAgentInput,
  TechnicalAgentOutput
> = {
  type: AgentType.TECHNICAL_ANALYST,
  version: 1,
  displayName: 'Technical Analyst Agent',
  description:
    'Analyzes technical indicators, momentum, and price structure to identify market conditions.',
  status: AgentStatus.ACTIVE,
  executionMode: AgentExecutionMode.SYNCHRONOUS,
  inputSchema: TechnicalAgentInputSchema,
  outputSchema: TechnicalAgentOutputSchema,
  promptId: 'technical_analyst_v1',
  promptVersion: 1,
  allowedToolNames: [...TECHNICAL_ANALYST_ALLOWED_TOOLS],
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
    ],
    requiredSections: [],
    maximumAgeSecondsBySection: {
      [AgentContextSection.MARKET_CANDLES]: 300,
      [AgentContextSection.MARKET_INDICATORS]: 0,
    },
    maxItemsBySection: { [AgentContextSection.MARKET_CANDLES]: 500 },
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
  maxToolRounds: 2,
  maxToolCalls: 2,
  maxInputTokens: 10_000,
  maxOutputTokens: 2_000,
  requiresUserContext: false,
  allowsPublicSystemRun: true,
  buildToolCalls: (input) => [
    {
      toolName: 'market.indicators.get',
      arguments: {
        symbol: input.symbol,
        provider: input.provider,
        interval: input.interval,
      },
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
  ],
  buildInsufficientOutput: (usedTools, reason) => ({
    summary: `Technical analysis could not be completed reliably: ${reason}`,
    trend: { direction: 'SIDEWAYS', strength: 'WEAK' },
    momentum: {
      rsi: 'Unavailable',
      rsiState: 'NEUTRAL',
      macd: { trend: 'NEUTRAL', crossover: 'NONE' },
    },
    movingAverages: { alignment: 'MIXED', pricePosition: 'INSIDE' },
    volatility: { bollinger: { position: 'MIDDLE', squeeze: false } },
    structure: { marketStructure: 'RANGE' },
    divergence: { rsiDivergence: 'NONE', macdDivergence: 'NONE' },
    signals: ['Insufficient current indicator data for reliable analysis.'],
    dataQuality: 'INSUFFICIENT',
    usedTools: usedTools.filter(
      (tool): tool is (typeof TECHNICAL_ANALYST_ALLOWED_TOOLS)[number] =>
        TECHNICAL_ANALYST_ALLOWED_TOOLS.includes(
          tool as (typeof TECHNICAL_ANALYST_ALLOWED_TOOLS)[number],
        ),
    ),
    generatedAt: new Date().toISOString(),
  }),
};
