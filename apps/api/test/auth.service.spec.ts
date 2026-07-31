import { HttpException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../src/audit/audit.service";
import { AuthService } from "../src/auth/auth.service";
import type { UserRepository } from "../src/auth/user.repository";
import type { RedisService } from "../src/redis/redis.service";
import type { SessionService } from "../src/session/session.service";
import type { PasswordPolicyService } from "../src/auth/password-policy.service";
import type { TotpService } from "../src/auth/totp.service";
import type { EmailDeliveryService } from "../src/auth/email-delivery.service";
import { ConfigService } from "@nestjs/config";

function makeService(
  users: object,
  sessions: object,
  redis: object,
  audit: object,
): AuthService {
  return new AuthService(
    users as unknown as UserRepository,
    sessions as unknown as SessionService,
    redis as unknown as RedisService,
    audit as unknown as AuditService,
    {
      assertStrong: vi.fn().mockResolvedValue(undefined),
    } as unknown as PasswordPolicyService,
    {} as unknown as TotpService,
    {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as EmailDeliveryService,
    new ConfigService({ EMAIL_VERIFICATION_ENABLED: false }),
  );
}

describe("AuthService", () => {
  it("hashes registered passwords with Argon2id before persistence", async () => {
    let storedHash = "";
    const now = new Date();
    const users = {
      findByIdentifier: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockImplementation(
          (email: string, username: string, passwordHash: string) => {
            storedHash = passwordHash;
            return {
              id: "user-id",
              email,
              username,
              passwordHash,
              failedLogins: 0,
              lockedUntil: null,
              createdAt: now,
              updatedAt: now,
            };
          },
        ),
    };
    const sessions = { create: vi.fn().mockResolvedValue("session-token") };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = makeService(users, sessions, {}, audit);

    await service.register(
      {
        email: "user@example.com",
        username: "user_name",
        password: "registration-password",
      },
      {},
    );

    expect(storedHash).toMatch(/^\$argon2id\$/);
    expect(storedHash).not.toContain("registration-password");
  });

  it("rejects login while an account lock is active", async () => {
    const users = {
      findByIdentifier: vi.fn().mockResolvedValue({
        lockedUntil: new Date(Date.now() + 60_000),
      }),
    };
    const redis = { get: vi.fn().mockResolvedValue(null) };
    const service = makeService(users, {}, redis, {});

    const error = await service
      .login({ identifier: "user@example.com", password: "password" }, {})
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  });

  it("returns only the public current-user fields", async () => {
    const user = {
      id: "user-id",
      email: "user@example.com",
      username: "user",
      passwordHash: "secret-hash",
      failedLogins: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const users = { findById: vi.fn().mockResolvedValue(user) };
    const service = makeService(users, {}, {}, {});
    const result = await service.me("user-id");
    expect(result).toEqual({
      id: user.id,
      email: user.email,
      username: user.username,
      emailVerified: false,
      totpEnabled: false,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("issues a short-lived reset token without storing the raw value", async () => {
    const users = {
      findByEmail: vi
        .fn()
        .mockResolvedValue({ id: "user-id", email: "user@example.com" }),
    };
    const redis = {
      setWithTtl: vi.fn().mockResolvedValue(undefined),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = makeService(users, {}, redis, audit);
    const token = await service.requestPasswordReset("user@example.com", {});
    expect(token).toHaveLength(43);
    expect(redis.setWithTtl).toHaveBeenCalledWith(
      expect.not.stringContaining(token ?? ""),
      "user-id",
      900,
    );
  });

  it("atomically consumes a password-reset token before changing the password", async () => {
    const users = {
      findById: vi.fn().mockResolvedValue({
        id: "user-id",
        email: "user@example.com",
        username: "user",
      }),
      updatePassword: vi.fn().mockResolvedValue(undefined),
    };
    const sessions = { destroyAll: vi.fn().mockResolvedValue(undefined) };
    const redis = {
      get: vi.fn().mockResolvedValue("user-id"),
      getAndDelete: vi
        .fn()
        .mockResolvedValueOnce("user-id")
        .mockResolvedValueOnce(null),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = makeService(users, sessions, redis, audit);
    const dto = { token: "a".repeat(43), newPassword: "new-password-value" };

    await expect(service.resetPassword(dto, {})).resolves.toBeUndefined();
    await expect(service.resetPassword(dto, {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(users.updatePassword).toHaveBeenCalledOnce();
    expect(sessions.destroyAll).toHaveBeenCalledWith("user-id");
  });
});
