import { z } from 'zod';
import { PerformanceRecordSchema, ReflectionOutputSchema } from '@platform/shared';
import type { AgentDefinition } from '../models/agent-definition.model';
import { AgentExecutionMode, AgentMemoryMode, AgentStatus, AgentType } from '../enums';
import type { AgentContextSection } from '../enums';

const ReflectionInputSchema = z.object({ recentRecords: z.array(PerformanceRecordSchema).min(1).max(500) }).strict();

export const REFLECTION_DEFINITION: AgentDefinition = {
  type: AgentType.REFLECTION,
  version: 1,
  displayName: 'Reflection Agent',
  description: 'Analyzes virtual decision outcomes and suggests human-reviewed improvements without modifying decision logic.',
  status: AgentStatus.ACTIVE,
  executionMode: AgentExecutionMode.SYNCHRONOUS,
  inputSchema: ReflectionInputSchema,
  outputSchema: ReflectionOutputSchema,
  promptId: 'reflection-v1', promptVersion: 1,
  allowedToolNames: [], requiredCapabilities: [],
  memoryPolicy: { mode: AgentMemoryMode.LONG_TERM_READ_WRITE, readTypes: ['REFLECTION'], writeTypes: ['REFLECTION'], maxItems: 20, persistFinalOutput: true },
  contextPolicy: { allowedSections: [] as AgentContextSection[], requiredSections: [], maximumAgeSecondsBySection: {}, maxItemsBySection: {}, includeUserSettings: false, includeOpenPositions: false, includeMemory: true, includePreviousAgentResults: false },
  modelPolicy: { fallbackProviders: ['ANTHROPIC', 'GEMINI', 'OLLAMA'], requiresToolCalling: false, requiresStructuredOutput: true, supportsStreaming: false, maximumTemperature: 0.3, defaultTemperature: 0.1 },
  retryPolicy: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 5000, retryableErrorCodes: ['AGENT_PROVIDER_UNAVAILABLE', 'AGENT_TIMEOUT'] },
  timeoutMs: 60_000, maxToolRounds: 0, maxToolCalls: 0, maxInputTokens: 12_000, maxOutputTokens: 2_000,
  requiresUserContext: true, allowsPublicSystemRun: false,
};
