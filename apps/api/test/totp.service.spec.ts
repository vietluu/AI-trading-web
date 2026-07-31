import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import { TotpService } from "../src/auth/totp.service";

function service(): TotpService {
  return new TotpService(
    new ConfigService({
      ENCRYPTION_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    }),
  );
}

describe("TotpService", () => {
  it("verifies the RFC 6238 SHA-1 vector using six digits", () => {
    const totp = service();
    expect(
      totp.verify("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 59_000),
    ).toBe(true);
    expect(
      totp.verify("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "000000", 59_000),
    ).toBe(false);
  });

  it("encrypts authenticator secrets with user-bound additional data", () => {
    const totp = service();
    const encrypted = totp.encrypt("SECRET", "user-one");
    expect(encrypted).not.toContain("SECRET");
    expect(totp.decrypt(encrypted, "user-one")).toBe("SECRET");
    expect(() => totp.decrypt(encrypted, "user-two")).toThrow();
  });
});
