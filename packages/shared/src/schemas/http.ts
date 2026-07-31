import { z } from "zod";

export const serviceHealthSchema = z.object({
  status: z.enum(["up", "down"]),
  latencyMs: z.number().int().nonnegative(),
});

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  timestamp: z.string().datetime(),
  services: z.object({
    database: serviceHealthSchema,
    redis: serviceHealthSchema,
  }),
});

export const apiErrorSchema = z.object({
  statusCode: z.number().int().min(400).max(599),
  timestamp: z.string().datetime(),
  path: z.string().startsWith("/"),
  message: z.string().min(1),
  error: z.string().min(1),
  code: z.string().optional(),
  provider: z.string().optional(),
  retryable: z.boolean().optional(),
  correlationId: z.string().optional(),
});

export type ServiceHealth = z.infer<typeof serviceHealthSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
