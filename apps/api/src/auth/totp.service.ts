import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface Envelope {
  iv: string;
  tag: string;
  ciphertext: string;
}
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

@Injectable()
export class TotpService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(
      config.getOrThrow<string>("ENCRYPTION_MASTER_KEY"),
      "base64",
    );
  }

  createSecret(): string {
    return this.base32Encode(randomBytes(20));
  }

  uri(secret: string, email: string): string {
    const issuer = "AI Trading Research";
    return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  }

  verify(secret: string, code: string, now = Date.now()): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    const counter = Math.floor(now / 30_000);
    return [-1, 0, 1].some((offset) => {
      const expected = this.code(secret, counter + offset);
      return timingSafeEqual(Buffer.from(expected), Buffer.from(code));
    });
  }

  encrypt(secret: string, userId: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`totp:${userId}`));
    const ciphertext = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    return JSON.stringify({
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    } satisfies Envelope);
  }

  decrypt(value: string, userId: string): string {
    const envelope = JSON.parse(value) as Envelope;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAAD(Buffer.from(`totp:${userId}`));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  private code(secret: string, counter: number): string {
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac("sha1", this.base32Decode(secret))
      .update(message)
      .digest();
    const offset = digest[digest.length - 1]! & 0x0f;
    const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    return binary.toString().padStart(6, "0");
  }

  private base32Encode(buffer: Buffer): string {
    let bits = "";
    for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
    let result = "";
    for (let index = 0; index < bits.length; index += 5) {
      result += alphabet.charAt(
        Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2),
      );
    }
    return result;
  }

  private base32Decode(value: string): Buffer {
    let bits = "";
    for (const character of value.replace(/=+$/, "").toUpperCase()) {
      const index = alphabet.indexOf(character);
      if (index < 0) throw new Error("Invalid TOTP secret");
      bits += index.toString(2).padStart(5, "0");
    }
    const bytes: number[] = [];
    for (let index = 0; index + 8 <= bits.length; index += 8) {
      bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
    }
    return Buffer.from(bytes);
  }
}
