import { z } from "zod";

const environmentSchema = z
  .object({
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
    SESSION_SECRET: z.string().min(32),
    SESSION_TTL: z.coerce
      .number()
      .int()
      .min(300)
      .max(2_592_000)
      .default(86_400),
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    COOKIE_DOMAIN: z
      .string()
      .optional()
      .transform((value) => value || undefined),
    ENCRYPTION_MASTER_KEY: z
      .string()
      .refine(
        (value) => Buffer.from(value, "base64").length === 32,
        "ENCRYPTION_MASTER_KEY must be a base64-encoded 32-byte key",
      ),
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
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === "production" && !environment.COOKIE_SECURE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "COOKIE_SECURE must be true in production",
        path: ["COOKIE_SECURE"],
      });
    }
  });

export type ApiEnvironment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  configuration: Record<string, unknown>,
): ApiEnvironment {
  return environmentSchema.parse(configuration);
}
