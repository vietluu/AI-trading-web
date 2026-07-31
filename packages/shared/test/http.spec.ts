import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "../src/index.js";

describe("healthResponseSchema", () => {
  it("accepts a valid platform health response", () => {
    const result = healthResponseSchema.safeParse({
      status: "ok",
      timestamp: "2026-07-31T00:00:00.000Z",
      services: {
        database: { status: "up", latencyMs: 4 },
        redis: { status: "up", latencyMs: 1 },
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects an unknown service status", () => {
    const result = healthResponseSchema.safeParse({
      status: "ok",
      timestamp: "2026-07-31T00:00:00.000Z",
      services: {
        database: { status: "unknown", latencyMs: 4 },
        redis: { status: "up", latencyMs: 1 },
      },
    });

    expect(result.success).toBe(false);
  });
});
