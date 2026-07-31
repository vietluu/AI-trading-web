import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import { EncryptionService } from "../src/credentials/encryption.service";

describe("EncryptionService", () => {
  const service = new EncryptionService(
    new ConfigService({
      ENCRYPTION_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
    }),
  );

  it("round-trips credential data without embedding plaintext", () => {
    const encrypted = service.encrypt({
      apiKey: "openai-secret-key",
      secret: "exchange-secret",
    });
    expect(encrypted).not.toContain("openai-secret-key");
    expect(service.decrypt(encrypted)).toEqual({
      apiKey: "openai-secret-key",
      secret: "exchange-secret",
    });
  });

  it("rejects a modified authentication tag", () => {
    const encrypted = JSON.parse(service.encrypt({ apiKey: "abcd" })) as Record<
      string,
      unknown
    >;
    encrypted.tag = Buffer.alloc(16).toString("base64");
    expect(() => service.decrypt(JSON.stringify(encrypted))).toThrow();
  });

  it("binds ciphertext to its user and provider context", () => {
    const encrypted = service.encrypt({ apiKey: "abcd" }, "user-one:OPENAI");
    expect(() => service.decrypt(encrypted, "user-two:OPENAI")).toThrow();
  });
});
