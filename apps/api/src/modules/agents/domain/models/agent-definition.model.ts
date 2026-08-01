import type { ZodType } from 'zod';
import { type AgentType, type AgentStatus, type AgentExecutionMode, type AgentContextSection, type AgentMemoryMode } from '../enums';

export interface AgentContextPolicy {
  readonly allowedSections: AgentContextSection[];
  readonly requiredSections: AgentContextSection[];
  readonly maximumAgeSecondsBySection: Partial<Record<AgentContextSection, number>>;
  readonly maxItemsBySection: Partial<Record<AgentContextSection, number>>;
  readonly includeUserSettings: boolean;
  readonly includeOpenPositions: boolean;
  readonly includeMemory: boolean;
  readonly includePreviousAgentResults: boolean;
}

export interface AgentMemoryPolicy {
  readonly mode: AgentMemoryMode;
  readonly readTypes: string[];
  readonly writeTypes: string[];
  readonly maxItems: number;
  readonly maximumAgeSeconds?: number;
  readonly similarityThreshold?: number;
  readonly persistFinalOutput: boolean;
}

export interface AgentModelPolicy {
  readonly preferredProvider?: string;
  readonly preferredModel?: string;
  readonly fallbackProviders: string[];
  readonly minimumContextWindow?: number;
  readonly requiresToolCalling: boolean;
  readonly requiresStructuredOutput: boolean;
  readonly supportsStreaming: boolean;
  readonly maximumTemperature: number;
  readonly defaultTemperature: number;
}

export interface AgentRetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly retryableErrorCodes: string[];
}

export interface AgentDefinition<TInput = unknown, TOutput = unknown> {
  readonly type: AgentType;
  readonly version: number;
  readonly displayName: string;
  readonly description: string;
  readonly status: AgentStatus;
  readonly executionMode: AgentExecutionMode;
  readonly inputSchema: ZodType<TInput>;
  readonly outputSchema: ZodType<TOutput>;
  readonly promptId: string;
  readonly promptVersion: number;
  readonly allowedToolNames: string[];
  readonly requiredCapabilities: string[];
  readonly memoryPolicy: AgentMemoryPolicy;
  readonly contextPolicy: AgentContextPolicy;
  readonly modelPolicy: AgentModelPolicy;
  readonly retryPolicy: AgentRetryPolicy;
  readonly timeoutMs: number;
  readonly maxToolRounds: number;
  readonly maxToolCalls: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly requiresUserContext: boolean;
  readonly allowsPublicSystemRun: boolean;
}
