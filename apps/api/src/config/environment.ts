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
    REMEMBER_ME_TTL: z.coerce
      .number()
      .int()
      .min(86_400)
      .max(7_776_000)
      .default(2_592_000),
    SESSION_FINGERPRINT_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    SESSION_FINGERPRINT_BIND_IP: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    EMAIL_VERIFICATION_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    WEB_APP_URL: z.string().url().default("http://localhost:3000"),
    AUTH_EMAIL_WEBHOOK_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url().optional(),
    ),
    AUTH_EMAIL_WEBHOOK_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(16).optional(),
    ),
    PASSWORD_BREACH_CHECK_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    TOTP_REQUIRED_FOR_SENSITIVE_ACTIONS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
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
    if (
      environment.EMAIL_VERIFICATION_ENABLED &&
      (!environment.AUTH_EMAIL_WEBHOOK_URL ||
        !environment.AUTH_EMAIL_WEBHOOK_SECRET)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Email verification requires AUTH_EMAIL_WEBHOOK_URL and AUTH_EMAIL_WEBHOOK_SECRET",
        path: ["EMAIL_VERIFICATION_ENABLED"],
      });
    }
  });

export type ApiEnvironment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  configuration: Record<string, unknown>,
): ApiEnvironment {
  return environmentSchema.parse(configuration);
}
