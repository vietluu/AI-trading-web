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
    'Provides a schema-stable on-chain analysis framework for activity and exchange flows.',
  status: AgentStatus.ACTIVE,
  executionMode: AgentExecutionMode.SYNCHRONOUS,
  inputSchema: OnChainAgentInputSchema,
  outputSchema: OnChainAgentOutputSchema,
  promptId: 'on_chain_analyst_v1',
  promptVersion: 1,
  allowedToolNames: [],
  requiredCapabilities: [],
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
    requiresToolCalling: false,
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
  maxToolRounds: 0,
  maxToolCalls: 0,
  maxInputTokens: 2_000,
  maxOutputTokens: 1_000,
  requiresUserContext: false,
  allowsPublicSystemRun: true,
  buildInsufficientOutput: (_usedTools, reason) => ({
    summary: `On-chain data is not yet connected: ${reason}`,
    activity: 'NORMAL',
    flows: {},
    signals: ['No verified on-chain provider is configured.'],
    dataQuality: 'INSUFFICIENT',
    generatedAt: new Date().toISOString(),
  }),
};
