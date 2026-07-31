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
      }),
    ).toThrow();
  });
});
