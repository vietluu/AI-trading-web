import {
  MacroAgentInputSchema,
  MacroAgentOutputSchema,
  type MacroAgentInput,
  type MacroAgentOutput,
} from '@platform/shared';
import type { AgentDefinition } from '../models/agent-definition.model';
import {
  AgentContextSection,
  AgentExecutionMode,
  AgentMemoryMode,
  AgentStatus,
  AgentType,
} from '../enums';

export const MACRO_ANALYST_ALLOWED_TOOLS = ['macro.events.list'] as const;

export const MACRO_ANALYST_DEFINITION: AgentDefinition<
  MacroAgentInput,
  MacroAgentOutput
> = {
  type: AgentType.MACRO_ANALYST,
  version: 1,
  displayName: 'Macro Analyst Agent',
  description:
    'Analyzes macroeconomic events, monetary policy, inflation, and global liquidity conditions.',
  status: AgentStatus.ACTIVE,
  executionMode: AgentExecutionMode.SYNCHRONOUS,
  inputSchema: MacroAgentInputSchema,
  outputSchema: MacroAgentOutputSchema,
  promptId: 'macro_analyst_v1',
  promptVersion: 1,
  allowedToolNames: [...MACRO_ANALYST_ALLOWED_TOOLS],
  requiredCapabilities: ['READ_MACRO'],
  memoryPolicy: {
    mode: AgentMemoryMode.NONE,
    readTypes: [],
    writeTypes: [],
    maxItems: 0,
    persistFinalOutput: false,
  },
  contextPolicy: {
    allowedSections: [AgentContextSection.MACRO],
    requiredSections: [],
    maximumAgeSecondsBySection: { [AgentContextSection.MACRO]: 24 * 60 * 60 },
    maxItemsBySection: { [AgentContextSection.MACRO]: 50 },
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
  maxToolRounds: 1,
  maxToolCalls: 1,
  maxInputTokens: 8_000,
  maxOutputTokens: 1_500,
  requiresUserContext: false,
  allowsPublicSystemRun: true,
  buildToolCalls: (input) => [
    {
      toolName: 'macro.events.list',
      arguments: { lookbackHours: input.lookbackHours, limit: 50 },
    },
  ],
  buildInsufficientOutput: (_usedTools, reason) => ({
    summary: `Macro analysis could not be completed reliably: ${reason}`,
    macroTrend: 'NEUTRAL',
    keyEvents: [],
    riskFactors: ['Insufficient current macroeconomic event data.'],
    dataQuality: 'INSUFFICIENT',
    generatedAt: new Date().toISOString(),
  }),
};
