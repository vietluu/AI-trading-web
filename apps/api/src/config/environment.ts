import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgresql://"), {
      message: "DATABASE_URL must use the postgresql protocol",
    }),
  REDIS_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("redis://"), {
      message: "REDIS_URL must use the redis protocol",
    }),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .refine((origins) => origins.length > 0, {
      message: "CORS_ORIGINS must contain at least one origin",
    }),
});

export type ApiEnvironment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  configuration: Record<string, unknown>,
): ApiEnvironment {
  return environmentSchema.parse(configuration);
}
