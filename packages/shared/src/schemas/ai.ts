import { z } from "zod";

export const AIProviderTypeSchema = z.enum(["OPENAI", "ANTHROPIC", "GEMINI", "OLLAMA"]);
export type AIProviderType = z.infer<typeof AIProviderTypeSchema>;

export const AIMemoryTypeSchema = z.enum([
  "CONVERSATION",
  "DECISION",
  "OBSERVATION",
  "REFLECTION",
  "MARKET_SNAPSHOT",
]);
export type AIMemoryType = z.infer<typeof AIMemoryTypeSchema>;

export const AIModelCapabilitiesSchema = z.object({
  supportsTools: z.boolean(),
  supportsVision: z.boolean(),
  supportsStreaming: z.boolean(),
  supportsJSON: z.boolean(),
});
export type AIModelCapabilities = z.infer<typeof AIModelCapabilitiesSchema>;

export const AIModelPricingSchema = z.object({
  inputCostPer1k: z.number(),
  outputCostPer1k: z.number(),
});
export type AIModelPricing = z.infer<typeof AIModelPricingSchema>;

export const AIModelSchema = z.object({
  provider: AIProviderTypeSchema,
  name: z.string(),
  displayName: z.string(),
  contextWindow: z.number(),
  maxOutput: z.number(),
  capabilities: AIModelCapabilitiesSchema,
  pricing: AIModelPricingSchema,
  isDefault: z.boolean().optional(),
});
export type AIModel = z.infer<typeof AIModelSchema>;

export const ProviderHealthStatusSchema = z.enum([
  "HEALTHY",
  "DEGRADED",
  "FAILED",
  "NOT_CONFIGURED",
]);
export type ProviderHealthStatus = z.infer<typeof ProviderHealthStatusSchema>;

export const AIProviderHealthSchema = z.object({
  provider: AIProviderTypeSchema,
  status: ProviderHealthStatusSchema,
  latencyMs: z.number(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  models: z.array(z.string()),
});
export type AIProviderHealth = z.infer<typeof AIProviderHealthSchema>;

export const AIRequestDtoSchema = z.object({
  provider: AIProviderTypeSchema.optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  systemPrompt: z.string().optional(),
  userPrompt: z.string().min(1),
  history: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "developer"]),
        content: z.string(),
      })
    )
    .optional(),
  context: z.record(z.unknown()).optional(),
  tools: z.array(z.string()).optional(),
  responseFormat: z.enum(["text", "json"]).optional(),
  jsonSchema: z.record(z.unknown()).optional(),
});
export type AIRequestDto = z.infer<typeof AIRequestDtoSchema>;

export const AIResponseUsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
  estimatedCost: z.number(),
});
export type AIResponseUsage = z.infer<typeof AIResponseUsageSchema>;

export const AIResponseDtoSchema = z.object({
  text: z.string(),
  json: z.record(z.unknown()).nullable(),
  finishReason: z.string(),
  usage: AIResponseUsageSchema,
  latencyMs: z.number(),
  provider: AIProviderTypeSchema,
  model: z.string(),
});
export type AIResponseDto = z.infer<typeof AIResponseDtoSchema>;

export const AIConfigDtoSchema = z.object({
  preferredProvider: AIProviderTypeSchema,
  preferredModel: z.string(),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().positive(),
  timeoutMs: z.number().positive(),
  dailyBudget: z.number().nonnegative(),
  monthlyBudget: z.number().nonnegative(),
  tokenBudget: z.number().nonnegative(),
  requestBudget: z.number().nonnegative(),
  fallbackEnabled: z.boolean(),
  fallbackProviders: z.array(AIProviderTypeSchema),
});
export type AIConfigDto = z.infer<typeof AIConfigDtoSchema>;

export const UpdateAIConfigDtoSchema = AIConfigDtoSchema.partial();
export type UpdateAIConfigDto = z.infer<typeof UpdateAIConfigDtoSchema>;

export const AIUsageDtoSchema = z.object({
  date: z.string(),
  requestCount: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
  totalCost: z.number(),
  dailyBudget: z.number(),
  budgetRemaining: z.number(),
  isBlocked: z.boolean(),
});
export type AIUsageDto = z.infer<typeof AIUsageDtoSchema>;

export const AIHistoryDtoSchema = z.object({
  id: z.string(),
  provider: AIProviderTypeSchema,
  model: z.string(),
  prompt: z.string(),
  systemPrompt: z.string().nullable(),
  response: z.string(),
  responseJson: z.record(z.unknown()).nullable(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
  estimatedCost: z.number(),
  latencyMs: z.number(),
  success: z.boolean(),
  finishReason: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type AIHistoryDto = z.infer<typeof AIHistoryDtoSchema>;
