import { z } from "zod";

export const ToolCategorySchema = z.enum([
  "MARKET_DATA",
  "TECHNICAL_INDICATOR",
  "NEWS",
  "SENTIMENT",
  "MACRO",
  "SOCIAL",
  "EXCHANGE_ACCOUNT_READ",
  "USER_SETTINGS",
  "AI_MEMORY",
  "SYSTEM",
  "FUTURE_ON_CHAIN",
  "FUTURE_EXECUTION",
]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

export const ToolSensitivitySchema = z.enum([
  "PUBLIC",
  "USER_PRIVATE",
  "USER_FINANCIAL",
  "SYSTEM_INTERNAL",
  "RESTRICTED",
]);
export type ToolSensitivity = z.infer<typeof ToolSensitivitySchema>;

export const ToolSideEffectSchema = z.enum([
  "NONE",
  "READ_ONLY",
  "USER_STATE_WRITE",
  "FINANCIAL_WRITE",
  "SYSTEM_WRITE",
]);
export type ToolSideEffect = z.infer<typeof ToolSideEffectSchema>;

export const ToolExecutionModeSchema = z.enum(["SYNCHRONOUS", "ASYNCHRONOUS"]);
export type ToolExecutionMode = z.infer<typeof ToolExecutionModeSchema>;

export const ToolStatusSchema = z.enum([
  "ACTIVE",
  "DISABLED",
  "DEPRECATED",
  "EXPERIMENTAL",
  "UNAVAILABLE",
]);
export type ToolStatus = z.infer<typeof ToolStatusSchema>;

export const ToolErrorCodeSchema = z.enum([
  "TOOL_NOT_FOUND",
  "TOOL_VERSION_UNSUPPORTED",
  "TOOL_DISABLED",
  "TOOL_DEPRECATED",
  "TOOL_NOT_ALLOWED_FOR_AGENT",
  "TOOL_CAPABILITY_DENIED",
  "TOOL_AUTHENTICATION_REQUIRED",
  "TOOL_USER_CONTEXT_REQUIRED",
  "TOOL_ARGUMENT_INVALID",
  "TOOL_ARGUMENT_TOO_LARGE",
  "TOOL_RESULT_INVALID",
  "TOOL_TIMEOUT",
  "TOOL_CANCELLED",
  "TOOL_RATE_LIMITED",
  "TOOL_QUOTA_EXCEEDED",
  "TOOL_LOOP_LIMIT_EXCEEDED",
  "TOOL_RECURSION_DETECTED",
  "TOOL_DEPENDENCY_UNAVAILABLE",
  "TOOL_EXECUTION_FAILED",
  "TOOL_RETRY_EXHAUSTED",
  "TOOL_IDEMPOTENCY_CONFLICT",
  "TOOL_PROVIDER_MAPPING_FAILED",
  "TOOL_SECRET_DETECTED",
  "TOOL_UNKNOWN_ERROR",
]);
export type ToolErrorCode = z.infer<typeof ToolErrorCodeSchema>;

export const ToolCapabilitySchema = z.enum([
  "READ_MARKET_DATA",
  "READ_INDICATORS",
  "READ_NEWS",
  "READ_SENTIMENT",
  "READ_MACRO",
  "READ_SOCIAL",
  "READ_USER_SETTINGS",
  "READ_USER_EXCHANGE_ACCOUNT",
  "READ_AI_MEMORY",
  "READ_AI_HISTORY",
  "VIEW_SYSTEM_HEALTH",
  "REQUEST_RISK_EVALUATION",
  "CREATE_LIVE_ORDER",
  "CANCEL_ORDER",
  "CLOSE_POSITION",
  "CHANGE_LEVERAGE",
]);
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;

export const ToolDefinitionDtoSchema = z.object({
  name: z.string(),
  version: z.number().int().positive(),
  displayName: z.string(),
  description: z.string(),
  category: ToolCategorySchema,
  sensitivity: ToolSensitivitySchema,
  sideEffect: ToolSideEffectSchema,
  executionMode: ToolExecutionModeSchema,
  status: ToolStatusSchema,
  requiresAuthentication: z.boolean(),
  userScoped: z.boolean(),
  requiredCapabilities: z.array(ToolCapabilitySchema),
  timeoutMs: z.number().int().positive(),
  schemaHash: z.string(),
  parametersSchema: z.record(z.unknown()),
});
export type ToolDefinitionDto = z.infer<typeof ToolDefinitionDtoSchema>;

export const ToolResultDtoSchema = z.object({
  invocationId: z.string(),
  toolName: z.string(),
  toolVersion: z.number(),
  status: z.enum([
    "SUCCESS",
    "PARTIAL",
    "FAILED",
    "DENIED",
    "CANCELLED",
    "TIMED_OUT",
  ]),
  data: z.unknown().optional(),
  error: z
    .object({
      code: ToolErrorCodeSchema,
      message: z.string(),
      retryable: z.boolean(),
      safeDetails: z.record(z.string()).optional(),
    })
    .optional(),
  metadata: z.object({
    startedAt: z.string(),
    completedAt: z.string(),
    durationMs: z.number(),
    cached: z.boolean(),
    stale: z.boolean(),
    sourceTimestamp: z.string().optional(),
    schemaVersion: z.number(),
  }),
});
export type ToolResultDto = z.infer<typeof ToolResultDtoSchema>;

export const ToolHealthDtoSchema = z.object({
  name: z.string(),
  version: z.number(),
  status: ToolStatusSchema,
  category: ToolCategorySchema,
  averageLatencyMs: z.number(),
  successRatePct: z.number(),
  lastInvocationAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type ToolHealthDto = z.infer<typeof ToolHealthDtoSchema>;

export const ToolInvocationRecordDtoSchema = z.object({
  id: z.string(),
  invocationId: z.string(),
  userId: z.string().nullable(),
  toolName: z.string(),
  toolVersion: z.number(),
  invocationSource: z.string(),
  status: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number(),
  cached: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  resultSizeBytes: z.number(),
  estimatedResultTokens: z.number(),
});
export type ToolInvocationRecordDto = z.infer<
  typeof ToolInvocationRecordDtoSchema
>;
