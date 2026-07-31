import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import { PasswordPolicyService } from "../src/auth/password-policy.service";

describe("PasswordPolicyService", () => {
  const policy = new PasswordPolicyService(
    new ConfigService({ PASSWORD_BREACH_CHECK_ENABLED: false }),
  );

  it("accepts a long password with mixed character classes", async () => {
    await expect(
      policy.assertStrong("Maple-River-92!", ["trader"]),
    ).resolves.toBeUndefined();
  });

  it("rejects predictable and identifier-derived passwords", async () => {
    await expect(
      policy.assertStrong("Trader-Account1!", ["trader"]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
