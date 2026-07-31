import { createHash } from "node:crypto";

import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class PasswordPolicyService {
  private readonly breachCheckEnabled: boolean;

  constructor(config: ConfigService) {
    this.breachCheckEnabled =
      config.get<boolean>("PASSWORD_BREACH_CHECK_ENABLED") ?? false;
  }

  async assertStrong(
    password: string,
    identifiers: string[] = [],
  ): Promise<void> {
    const categories = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rule) =>
      rule.test(password),
    ).length;
    if (password.length < 12 || categories < 3) {
      throw new BadRequestException(
        "Password must be at least 12 characters and use 3 of: lowercase, uppercase, number, symbol",
      );
    }
    const normalized = password.toLowerCase();
    if (
      ["password", "qwerty", "letmein", "123456"].some((part) =>
        normalized.includes(part),
      ) ||
      identifiers.some(
        (part) => part.length >= 3 && normalized.includes(part.toLowerCase()),
      )
    ) {
      throw new BadRequestException("Password is too easy to guess");
    }
    if (this.breachCheckEnabled) await this.assertNotBreached(password);
  }

  private async assertNotBreached(password: string): Promise<void> {
    const digest = createHash("sha1")
      .update(password)
      .digest("hex")
      .toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    let response: Response;
    try {
      response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { "Add-Padding": "true" },
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Password breach check is temporarily unavailable",
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        "Password breach check is temporarily unavailable",
      );
    }
    const breached = (await response.text())
      .split("\n")
      .some((line) => line.split(":")[0]?.trim() === suffix);
    if (breached)
      throw new BadRequestException(
        "This password appears in a known data breach",
      );
  }
}
