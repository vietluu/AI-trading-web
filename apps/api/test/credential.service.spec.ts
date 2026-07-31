import { ConfigService } from "@nestjs/config";
import { CredentialProvider, type EncryptedCredential } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../src/audit/audit.service";
import type { CredentialRepository } from "../src/credentials/credential.repository";
import { CredentialService } from "../src/credentials/credential.service";
import { EncryptionService } from "../src/credentials/encryption.service";

describe("CredentialService", () => {
  it("creates an encrypted record and returns masked metadata", async () => {
    let storedCiphertext = "";
    const repository = {
      create: vi
        .fn()
        .mockImplementation(
          (data: {
            userId: string;
            provider: CredentialProvider;
            label?: string;
            encryptedData: string;
            lastFour: string;
          }) => {
            storedCiphertext = data.encryptedData;
            return {
              ...data,
              id: "17fbb04b-6cb0-4a16-89e7-e68d85d939f8",
              label: data.label ?? null,
              status: "NOT_VERIFIED",
              lastVerified: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            } satisfies EncryptedCredential;
          },
        ),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const encryption = new EncryptionService(
      new ConfigService({
        ENCRYPTION_MASTER_KEY: Buffer.alloc(32, 9).toString("base64"),
      }),
    );
    const service = new CredentialService(
      repository as unknown as CredentialRepository,
      encryption,
      audit as unknown as AuditService,
    );
    const result = await service.create(
      "00000000-0000-0000-0000-000000000001",
      { provider: CredentialProvider.OPENAI, apiKey: "sk-secret-abcd" },
      {},
    );
    expect(storedCiphertext).not.toContain("sk-secret-abcd");
    expect(result.maskedKey).toBe("••••abcd");
    expect(result).not.toHaveProperty("encryptedData");
  });
});
