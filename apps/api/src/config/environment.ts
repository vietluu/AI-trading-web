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
    BINANCE_FUTURES_BASE_URL: z
      .string()
      .url()
      .default("https://fapi.binance.com"),
    BINANCE_FUTURES_TESTNET_BASE_URL: z
      .string()
      .url()
      .default("https://testnet.binancefuture.com"),
    OKX_BASE_URL: z.string().url().default("https://www.okx.com"),
    OKX_DEMO_TRADING_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    EXCHANGE_HTTP_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(30_000)
      .default(10_000),
    EXCHANGE_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),
    EXCHANGE_RETRY_BASE_DELAY_MS: z.coerce
      .number()
      .int()
      .min(50)
      .max(2_000)
      .default(300),
    EXCHANGE_PUBLIC_RATE_LIMIT_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    EXCHANGE_PRIVATE_RATE_LIMIT_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    EXCHANGE_PUBLIC_RATE_LIMIT_PER_MINUTE: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .default(1200),
    EXCHANGE_PRIVATE_RATE_LIMIT_PER_MINUTE: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .default(300),
    EXCHANGE_INSTRUMENT_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(3600),
    EXCHANGE_TICKER_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(60)
      .default(3),
    EXCHANGE_TIME_OFFSET_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(3600)
      .default(300),
    EXCHANGE_PRODUCTION_CONNECTIONS_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    EXCHANGE_REQUIRE_RECENT_AUTH: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    EXCHANGE_RECENT_AUTH_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(900)
      .default(600),
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
    // Phase 4: Market Data Pipeline
    MARKET_DATA_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    MARKET_DATA_PROVIDERS: z
      .string()
      .default("BINANCE_FUTURES,OKX_FUTURES")
      .transform((value) =>
        value
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0),
      ),
    MARKET_DATA_SYMBOLS: z
      .string()
      .default("BTC-USDT,ETH-USDT")
      .transform((value) =>
        value
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter((s) => s.length > 0),
      ),
    MARKET_DATA_INTERVALS: z
      .string()
      .default("1m,5m,15m,1h,4h")
      .transform((value) =>
        value
          .split(",")
          .map((i) => i.trim())
          .filter((i) => i.length > 0),
      ),
    MARKET_TICKER_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    MARKET_TRADES_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    MARKET_CANDLES_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    MARKET_ORDER_BOOK_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    MARKET_FUNDING_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    MARKET_OPEN_INTEREST_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    MARKET_ORDER_BOOK_DEPTH: z.coerce
      .number()
      .int()
      .min(5)
      .max(100)
      .default(20),
    MARKET_ORDER_BOOK_SNAPSHOT_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(60)
      .default(10),
    MARKET_FUNDING_POLL_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(3600)
      .default(300),
    MARKET_OPEN_INTEREST_POLL_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .min(10)
      .max(3600)
      .default(60),
    MARKET_STALE_AFTER_SECONDS: z.coerce
      .number()
      .int()
      .min(5)
      .max(300)
      .default(30),
    MARKET_RECONNECT_BASE_DELAY_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(10_000)
      .default(500),
    MARKET_RECONNECT_MAX_DELAY_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60_000)
      .default(30_000),
    MARKET_MAX_RECONNECT_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(0)
      .max(100)
      .default(0),
    MARKET_WRITE_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(100),
    MARKET_WRITE_FLUSH_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(10_000)
      .default(1000),
    BINANCE_FUTURES_WS_URL: z
      .string()
      .url()
      .default("wss://fstream.binance.com"),
    BINANCE_FUTURES_TESTNET_WS_URL: z
      .string()
      .url()
      .default("wss://stream.binancefuture.com"),
    OKX_WS_PUBLIC_URL: z
      .string()
      .url()
      .default("wss://ws.okx.com:8443/ws/v5/public"),
    // Phase 6.1: AI Infrastructure
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    GOOGLE_API_KEY: z.string().optional(),
    OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
    DEFAULT_PROVIDER: z.enum(["OPENAI", "ANTHROPIC", "GEMINI", "OLLAMA"]).default("OPENAI"),
    DEFAULT_MODEL: z.string().default("gpt-5-mini"),
    DEFAULT_MAX_TOKENS: z.coerce.number().int().default(2048),
    DEFAULT_TEMPERATURE: z.coerce.number().default(0.7),
    DEFAULT_TIMEOUT: z.coerce.number().int().default(30000),

    // Phase 6.2: AI Tool Calling Framework
    AI_TOOL_CALLING_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
    AI_TOOL_MANUAL_TEST_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    AI_TOOL_MAX_ROUNDS: z.coerce.number().int().default(5),
    AI_TOOL_MAX_CALLS_PER_REQUEST: z.coerce.number().int().default(10),
    AI_TOOL_MAX_PARALLEL_CALLS: z.coerce.number().int().default(3),
    AI_TOOL_RECURSION_LIMIT: z.coerce.number().int().default(2),
    AI_TOOL_IDENTICAL_CALL_LIMIT: z.coerce.number().int().default(2),
    AI_TOOL_DEFAULT_TIMEOUT_MS: z.coerce.number().int().default(10000),
    AI_TOOL_TOTAL_REQUEST_TIMEOUT_MS: z.coerce.number().int().default(60000),
    AI_TOOL_MAX_ARGUMENT_BYTES: z.coerce.number().int().default(32768),
    AI_TOOL_MAX_RESULT_BYTES: z.coerce.number().int().default(262144),
    AI_TOOL_MAX_RESULT_TOKENS_PER_REQUEST: z.coerce.number().int().default(12000),
    AI_TOOL_MAX_CALLS_PER_MINUTE: z.coerce.number().int().default(30),
    AI_TOOL_MAX_CALLS_PER_HOUR: z.coerce.number().int().default(500),
    AI_TOOL_MAX_CALLS_PER_DAY: z.coerce.number().int().default(5000),
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
