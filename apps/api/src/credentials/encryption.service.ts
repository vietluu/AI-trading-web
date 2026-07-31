import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface Envelope {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface CredentialSecret {
  apiKey: string;
  secret?: string;
  passphrase?: string;
}

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(
      config.getOrThrow<string>("ENCRYPTION_MASTER_KEY"),
      "base64",
    );
  }

  encrypt(value: CredentialSecret, additionalData?: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    if (additionalData) cipher.setAAD(Buffer.from(additionalData, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    const envelope: Envelope = {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    return JSON.stringify(envelope);
  }

  decrypt(value: string, additionalData?: string): CredentialSecret {
    const envelope = JSON.parse(value) as Envelope;
    if (envelope.version !== 1)
      throw new Error("Unsupported credential envelope version");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(envelope.iv, "base64"),
    );
    if (additionalData) decipher.setAAD(Buffer.from(additionalData, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as CredentialSecret;
  }
}
