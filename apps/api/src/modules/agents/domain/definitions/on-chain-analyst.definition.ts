import {
  OnChainAgentInputSchema,
  OnChainAgentOutputSchema,
  type OnChainAgentInput,
  type OnChainAgentOutput,
} from '@platform/shared';
import type { AgentDefinition } from '../models/agent-definition.model';
import {
  AgentExecutionMode,
  AgentMemoryMode,
  AgentStatus,
  AgentType,
} from '../enums';

export const ON_CHAIN_ANALYST_DEFINITION: AgentDefinition<
  OnChainAgentInput,
  OnChainAgentOutput
> = {
  type: AgentType.ON_CHAIN_ANALYST,
  version: 1,
  displayName: 'On-chain Analyst Agent',
  description:
    'Analyzes verified network activity and exchange-flow metrics from Coin Metrics.',
  status: AgentStatus.ACTIVE,
  executionMode: AgentExecutionMode.SYNCHRONOUS,
  inputSchema: OnChainAgentInputSchema,
  outputSchema: OnChainAgentOutputSchema,
  promptId: 'on_chain_analyst_v1',
  promptVersion: 1,
  allowedToolNames: ['onchain.metrics.get'],
  requiredCapabilities: ['READ_ONCHAIN_DATA'],
  memoryPolicy: {
    mode: AgentMemoryMode.NONE,
    readTypes: [],
    writeTypes: [],
    maxItems: 0,
    persistFinalOutput: false,
  },
  contextPolicy: {
    allowedSections: [],
    requiredSections: [],
    maximumAgeSecondsBySection: {},
    maxItemsBySection: {},
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
    maxRetries: 1,
    baseDelayMs: 500,
    maxDelayMs: 2_000,
    retryableErrorCodes: ['AGENT_PROVIDER_UNAVAILABLE', 'AGENT_TIMEOUT'],
  },
  timeoutMs: 30_000,
  maxToolRounds: 1,
  maxToolCalls: 1,
  maxInputTokens: 2_000,
  maxOutputTokens: 1_000,
  requiresUserContext: false,
  allowsPublicSystemRun: true,
  buildToolCalls: (input) => [{
    toolName: 'onchain.metrics.get',
    arguments: {
      symbol: input.symbol ?? 'BTC-USDT',
      lookbackHours: input.lookbackHours,
    },
  }],
  buildInsufficientOutput: (_usedTools, reason) => ({
    summary: `Verified on-chain data is unavailable for this asset: ${reason}`,
    activity: 'NORMAL',
    flows: {},
    signals: ['Coin Metrics returned no verified coverage for this asset or was unavailable.'],
    dataQuality: 'INSUFFICIENT',
    generatedAt: new Date().toISOString(),
  }),
};
