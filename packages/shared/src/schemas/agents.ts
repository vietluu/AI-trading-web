import { z } from 'zod';

export const AgentTypeSchema = z.enum([
  'MARKET_ANALYST',
  'TECHNICAL_ANALYST',
  'NEWS_ANALYST',
  'SOCIAL_ANALYST',
  'MACRO_ANALYST',
  'ON_CHAIN_ANALYST',
  'RISK_REVIEWER',
  'DECISION_SYNTHESIZER',
  'JUDGE',
  'MEMORY_AGENT',
  'PERFORMANCE',
  'REFLECTION',
  'SYSTEM_DIAGNOSTIC',
]);
export type AgentType = z.infer<typeof AgentTypeSchema>;

export const AgentRunStatusSchema = z.enum([
  'CREATED',
  'QUEUED',
  'PREPARING_CONTEXT',
  'READY',
  'RUNNING',
  'WAITING_FOR_TOOL',
  'PROCESSING_TOOL_RESULT',
  'VALIDATING_OUTPUT',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'FAILED',
  'TIMED_OUT',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'REJECTED',
]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

export const AgentInvocationSourceSchema = z.enum([
  'USER_MANUAL',
  'INTERNAL_SERVICE',
  'SYSTEM_TEST',
  'REPLAY',
  'FUTURE_SCHEDULED',
  'FUTURE_EVENT_DRIVEN',
]);
export type AgentInvocationSource = z.infer<typeof AgentInvocationSourceSchema>;

export const AgentHealthStatusSchema = z.enum([
  'HEALTHY',
  'DEGRADED',
  'UNHEALTHY',
  'UNKNOWN',
  'INITIALIZING',
  'OFFLINE'
]);
export type AgentHealthStatus = z.infer<typeof AgentHealthStatusSchema>;

export const AgentDefinitionDtoSchema = z.object({
  name: z.string().optional(),
  type: AgentTypeSchema,
  version: z.number().int().nonnegative(),
  displayName: z.string(),
  description: z.string(),
  status: z.enum(['ACTIVE', 'DISABLED', 'DEPRECATED', 'EXPERIMENTAL', 'UNAVAILABLE']),
  promptId: z.string(),
  promptVersion: z.number().int().nonnegative(),
  allowedTools: z.array(z.string()),
  capabilities: z.array(z.string()),
  health: AgentHealthStatusSchema.optional(),
  avgLatencyMs: z.number().optional(),
  successRatePct: z.number().optional(),
});
export type AgentDefinitionDto = z.infer<typeof AgentDefinitionDtoSchema>;

export const AgentRunDtoSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  agentType: AgentTypeSchema,
  agentVersion: z.number().int(),
  status: AgentRunStatusSchema,
  invocationSource: AgentInvocationSourceSchema,
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  estimatedCost: z.number(),
  toolCallCount: z.number(),
  toolRoundCount: z.number(),
  retryCount: z.number(),
  failureCode: z.string().nullable().optional(),
  safeFailureMessage: z.string().nullable().optional(),
  traceId: z.string().nullable().optional(),
  correlationId: z.string().nullable().optional(),
  parentRunId: z.string().uuid().nullable().optional(),
  replayOfRunId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type AgentRunDto = z.infer<typeof AgentRunDtoSchema>;

export const AgentRunTransitionDtoSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  fromState: AgentRunStatusSchema,
  toState: AgentRunStatusSchema,
  reason: z.string(),
  actor: z.string(),
  createdAt: z.string().datetime(),
});
export type AgentRunTransitionDto = z.infer<typeof AgentRunTransitionDtoSchema>;

export const AgentContextSnapshotDtoSchema = z.object({
  id: z.string().uuid(),
  symbol: z.string().nullable().optional(),
  timeframe: z.string().nullable().optional(),
  sourceDataCutoff: z.string().datetime(),
  schemaVersion: z.number().int(),
  contextHash: z.string(),
  tokenEstimate: z.number().int(),
  createdAt: z.string().datetime(),
});
export type AgentContextSnapshotDto = z.infer<typeof AgentContextSnapshotDtoSchema>;

export const AgentHealthDtoSchema = z.object({
  agentType: AgentTypeSchema,
  version: z.number().int(),
  status: z.enum(['ACTIVE', 'DISABLED', 'DEPRECATED', 'EXPERIMENTAL', 'UNAVAILABLE']),
  healthStatus: AgentHealthStatusSchema,
  reasons: z.array(z.string()),
  avgLatencyMs: z.number(),
  successRatePct: z.number(),
  totalRuns: z.number().int(),
  activeRuns: z.number().int(),
});
export type AgentHealthDto = z.infer<typeof AgentHealthDtoSchema>;

export const DiagnosticAgentOutputSchema = z.object({
  summary: z.string(),
  observations: z.array(z.string()),
  dataQuality: z.string(),
  usedTools: z.array(z.string()),
  generatedAt: z.string().datetime(),
});
export type DiagnosticAgentOutput = z.infer<typeof DiagnosticAgentOutputSchema>;

export const AgentRunFilterDtoSchema = z.object({
  agentType: AgentTypeSchema.optional(),
  status: AgentRunStatusSchema.optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  invocationSource: AgentInvocationSourceSchema.optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  parentRunId: z.string().uuid().optional(),
  replayOfRunId: z.string().uuid().optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  sort: z.enum(['asc', 'desc']).optional(),
});
export type AgentRunFilterDto = z.infer<typeof AgentRunFilterDtoSchema>;
