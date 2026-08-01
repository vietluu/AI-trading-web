import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class ToolResultSanitizer {
  private readonly logger = new Logger(ToolResultSanitizer.name);

  private readonly secretRegexes: RegExp[] = [
    /sk-[a-zA-Z0-9_-]{20,}/gi,
    /AIza[a-zA-Z0-9_-]{30,}/gi,
    /secret_[a-zA-Z0-9_-]{20,}/gi,
    /bearer\s+[a-zA-Z0-9._-]{20,}/gi,
    /-----BEGIN [A-Z\s]+PRIVATE KEY-----/gi,
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    /redis:\/\/[^\s]+/gi,
    /"(?:apiKey|apiSecret|passphrase|totpSecret|passwordHash|encryptedData)":\s*"[^"]+"/gi,
  ];

  public containsSecrets(data: unknown): boolean {
    const jsonStr = typeof data === "string" ? data : JSON.stringify(data || {});
    return this.secretRegexes.some((regex) => regex.test(jsonStr));
  }

  public sanitize<T>(data: T, maxBytes = 262144): T {
    if (data === null || data === undefined) {
      return data;
    }

    const sanitizedData = this.recursiveSanitize(data);
    const jsonStr = JSON.stringify(sanitizedData);

    // If payload exceeds byte limit, truncate safely
    if (Buffer.byteLength(jsonStr, "utf-8") > maxBytes) {
      this.logger.warn(`Tool output payload exceeds max bytes (${Buffer.byteLength(jsonStr)} > ${maxBytes}). Truncating output.`);
      if (Array.isArray(sanitizedData)) {
        return (sanitizedData.slice(0, Math.max(1, Math.floor(sanitizedData.length / 2))) as unknown) as T;
      } else if (typeof sanitizedData === "object") {
        return ({
          ...sanitizedData,
          _truncated: true,
          _truncationNotice: `Payload exceeded ${maxBytes} bytes and was truncated`,
        } as unknown) as T;
      }
    }

    return sanitizedData as T;
  }

  private recursiveSanitize(val: unknown): unknown {
    if (typeof val === "string") {
      let cleaned = val;
      for (const regex of this.secretRegexes) {
        cleaned = cleaned.replace(regex, "[REDACTED_SECRET]");
      }
      return cleaned;
    }

    if (Array.isArray(val)) {
      return val.map((item) => this.recursiveSanitize(item));
    }

    if (val !== null && typeof val === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes("secret") ||
          lowerKey.includes("password") ||
          lowerKey.includes("apikey") ||
          lowerKey.includes("apisecret") ||
          lowerKey.includes("passphrase") ||
          lowerKey.includes("totp") ||
          lowerKey.includes("encrypteddata")
        ) {
          result[key] = "[REDACTED_SENSITIVE_FIELD]";
        } else {
          result[key] = this.recursiveSanitize(value);
        }
      }
      return result;
    }

    return val;
  }
}
