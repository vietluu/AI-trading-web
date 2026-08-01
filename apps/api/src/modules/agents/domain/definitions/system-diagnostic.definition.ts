import { z } from 'zod';
import type { AgentDefinition } from '../models/agent-definition.model';
import {
  AgentType,
  AgentStatus,
  AgentExecutionMode,
  AgentMemoryMode,
  AgentContextSection,
} from '../enums';

const DiagnosticInput = z.object({
  symbol: z.string(),
  provider: z.string().optional(),
});

const DiagnosticOutput = z.object({
  summary: z.string(),
  observations: z.array(z.string()),
  dataQuality: z.enum(['GOOD', 'PARTIAL', 'INSUFFICIENT']),
  usedTools: z.array(z.string()),
  generatedAt: z.string(),
});

export type DiagnosticAgentInput = z.infer<typeof DiagnosticInput>;
export type DiagnosticAgentOutput = z.infer<typeof DiagnosticOutput>;

export const SYSTEM_DIAGNOSTIC_DEFINITION: AgentDefinition<DiagnosticAgentInput, DiagnosticAgentOutput> = {
  type: AgentType.SYSTEM_DIAGNOSTIC,
  version: 1,
  displayName: 'System Diagnostic Agent',
  description: 'Internal diagnostic agent for verifying framework functionality',
  status: AgentStatus.ACTIVE,
  executionMode: AgentExecutionMode.SYNCHRONOUS,
  inputSchema: DiagnosticInput,
  outputSchema: DiagnosticOutput,
  promptId: 'system-diagnostic-v1',
  promptVersion: 1,
  allowedToolNames: [
    'market.ticker.get',
    'market.indicators.get',
    'news.high_importance.list',
    'macro.events.list'
  ],
  requiredCapabilities: [
    'READ_MARKET_DATA',
    'READ_INDICATORS',
    'READ_NEWS',
    'READ_MACRO'
  ],
  memoryPolicy: {
    mode: AgentMemoryMode.SHORT_TERM,
    readTypes: ['OBSERVATION'],
    writeTypes: ['OBSERVATION'],
    maxItems: 5,
    persistFinalOutput: true
  },
  contextPolicy: {
    allowedSections: [
      AgentContextSection.MARKET_TICKER,
      AgentContextSection.MARKET_INDICATORS,
      AgentContextSection.NEWS,
      AgentContextSection.MACRO
    ],
    requiredSections: [
      AgentContextSection.MARKET_TICKER
    ],
    maximumAgeSecondsBySection: {},
    maxItemsBySection: {},
    includeUserSettings: false,
    includeOpenPositions: false,
    includeMemory: false,
    includePreviousAgentResults: false
  },
  modelPolicy: {
    requiresToolCalling: true,
    requiresStructuredOutput: true,
    defaultTemperature: 0.3,
    maximumTemperature: 0.5,
    fallbackProviders: ['ANTHROPIC', 'GEMINI', 'OLLAMA'],
    supportsStreaming: false
  },
  retryPolicy: {
    maxRetries: 2,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    retryableErrorCodes: ['AGENT_PROVIDER_UNAVAILABLE', 'AGENT_TIMEOUT']
  },
  timeoutMs: 60000,
  maxToolRounds: 3,
  maxToolCalls: 8,
  maxInputTokens: 8000,
  maxOutputTokens: 2000,
  requiresUserContext: false,
  allowsPublicSystemRun: true
};
