import { describe, expect, it } from "vitest";

import { credentialViewSchema } from "../src";

describe("credentialViewSchema", () => {
  it("accepts masked metadata without secret fields", () => {
    const result = credentialViewSchema.parse({
      id: "17fbb04b-6cb0-4a16-89e7-e68d85d939f8",
      provider: "OPENAI",
      label: null,
      status: "NOT_VERIFIED",
      maskedKey: "••••abcd",
      apiKey: "should-not-be-accepted",
      lastVerified: null,
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    });
    expect(result).not.toHaveProperty("apiKey");
  });
});
