import type { AIProviderType } from "@platform/shared";

export interface CanonicalJsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  description?: string;
  additionalProperties?: boolean;
}

export interface CanonicalToolSchema {
  name: string;
  description: string;
  inputJsonSchema: CanonicalJsonSchema;
  strict: boolean;
}

export interface ProviderToolCall {
  providerCallId: string;
  toolName: string;
  rawArguments: unknown;
  provider: AIProviderType;
  model: string;
  receivedAt: Date;
}

export interface InternalToolInvocation {
  invocationId: string;
  providerCallId?: string;
  toolName: string;
  requestedVersion?: number;
  arguments: unknown;
}
