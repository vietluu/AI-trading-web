import { describe, expect, it } from "vitest";

import { validateEnvironment } from "../src/config/environment";

describe("validateEnvironment", () => {
  it("coerces and validates the API configuration", () => {
    const environment = validateEnvironment({
      NODE_ENV: "test",
      API_PORT: "3100",
      DATABASE_URL: "postgresql://user:password@localhost:5432/platform",
      REDIS_URL: "redis://localhost:6379",
      CORS_ORIGINS: "http://localhost:3000, http://127.0.0.1:3000",
      SESSION_SECRET: "a-secure-test-session-secret-with-32-characters",
      ENCRYPTION_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    });

    expect(environment.API_PORT).toBe(3100);
    expect(environment.CORS_ORIGINS).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: "mysql://localhost/platform",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a-secure-test-session-secret-with-32-characters",
        ENCRYPTION_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      }),
    ).toThrow();
  });

  it("requires secure cookies in production", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://user:password@localhost:5432/platform",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a-secure-test-session-secret-with-32-characters",
        ENCRYPTION_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        COOKIE_SECURE: "false",
      }),
    ).toThrow("COOKIE_SECURE must be true in production");
  });

  it("requires an email delivery transport when email verification is enabled", () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: "postgresql://user:password@localhost:5432/platform",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a-secure-test-session-secret-with-32-characters",
        ENCRYPTION_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        EMAIL_VERIFICATION_ENABLED: "true",
      }),
    ).toThrow("require SMTP or AUTH_EMAIL_WEBHOOK");
  });

  it("accepts SMTP as the production password-reset transport", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://user:password@localhost:5432/platform",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a-secure-production-session-secret-with-32-characters",
        ENCRYPTION_MASTER_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
        COOKIE_SECURE: "true",
        AUTH_EMAIL_SMTP_HOST: "smtp.example.com",
        AUTH_EMAIL_FROM: "AI Trading <no-reply@example.com>",
      }),
    ).not.toThrow();
  });
});
