import { describe, expect, it } from "vitest";
import { createBullRootConfig } from "../../src/modules/pipeline/infrastructure/bull-config";

describe("pipeline BullMQ config", () => {
  it("uses REDIS_URL when provided for BullMQ connection", () => {
    const config = {
      get: (key: string) =>
        key === "REDIS_URL" ? "redis://redis.internal:6379" : undefined,
    } as never;

    expect(createBullRootConfig(config)).toEqual({
      connection: { url: "redis://redis.internal:6379" },
    });
  });

  it("falls back to localhost when REDIS_URL is missing", () => {
    const config = { get: () => undefined } as never;

    expect(createBullRootConfig(config)).toEqual({
      connection: { url: "redis://localhost:6379" },
    });
  });
});
