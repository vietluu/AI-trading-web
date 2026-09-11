import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { RedisService } from "../src/redis/redis.service";
import type { SessionRepository } from "../src/session/session.repository";
import { SessionService } from "../src/session/session.service";

function makeService(repository: object, redis: object): SessionService {
  return new SessionService(
    repository as unknown as SessionRepository,
    redis as unknown as RedisService,
    new ConfigService({
      SESSION_TTL: 3600,
      REMEMBER_ME_TTL: 7200,
      SESSION_SECRET: "a-session-secret-that-is-long-enough",
      SESSION_FINGERPRINT_ENABLED: true,
      SESSION_FINGERPRINT_BIND_IP: false,
    }),
  );
}

describe("SessionService", () => {
  it("stores only a derived session identifier", async () => {
    let storedData: Record<string, unknown> = {};
    const repository = {
      create: vi.fn().mockImplementation((data: Record<string, unknown>) => {
        storedData = data;
        return { id: "record-id", ...data };
      }),
    };
    const redis = { setWithTtl: vi.fn().mockResolvedValue(undefined) };
    const credentials = await makeService(repository, redis).create(
      "user-id",
      {},
    );
    expect(credentials.token).not.toBe(storedData.sessionId);
    expect(storedData.sessionId).toMatch(/^[a-f0-9]{64}$/);
    expect(redis.setWithTtl).toHaveBeenCalled();
  });

  it("removes an expired session from both stores", async () => {
    const repository = {
      findBySessionId: vi.fn().mockResolvedValue({
        id: "record-id",
        userId: "user-id",
        expiresAt: new Date(0),
        revokedAt: null,
      }),
      revoke: vi.fn().mockResolvedValue(undefined),
    };
    const redis = {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          id: "record-id",
          userId: "user-id",
          tokenFamily: "family",
          generation: 0,
          csrfHash: "hash",
          fingerprint: "fingerprint",
          expiresAt: new Date(0).toISOString(),
          rememberMe: false,
        }),
      ),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      makeService(repository, redis).resolve("raw-token", {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(redis.delete).toHaveBeenCalled();
    expect(repository.revoke).toHaveBeenCalled();
  });

  it("revokes a token family when a rotated token is reused past grace period", async () => {
    const repository = {
      findBySessionId: vi.fn().mockResolvedValue({
        tokenFamily: "family-id",
        rotatedAt: new Date(Date.now() - 60_000),
      }),
      listFamilyIdentifiers: vi
        .fn()
        .mockResolvedValue([{ sessionId: "old-id" }, { sessionId: "new-id" }]),
      revokeFamily: vi.fn().mockResolvedValue(undefined),
    };
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      makeService(repository, redis).resolve("reused-token", {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.revokeFamily).toHaveBeenCalledWith("family-id");
  });

  it("permits active session resolution when previous token is sent within concurrency grace period", async () => {
    const repository = {
      findBySessionId: vi.fn().mockResolvedValue({
        id: "old-id",
        userId: "user-id",
        tokenFamily: "family-id",
        revokedAt: new Date(Date.now() - 1000),
        rotatedAt: new Date(Date.now() - 1000), // 1s ago (within 30s grace period)
        expiresAt: new Date(Date.now() + 3600_000),
      }),
      findActiveByFamily: vi.fn(),
      revokeFamily: vi.fn().mockResolvedValue(undefined),
      listFamilyIdentifiers: vi.fn().mockResolvedValue([]),
    };
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const serviceInstance = makeService(repository, redis);
    repository.findActiveByFamily.mockImplementation(() => ({
      id: "active-id",
      userId: "user-id",
      tokenFamily: "family-id",
      generation: 2,
      csrfHash: "hash",
      fingerprint: (serviceInstance as unknown as { fingerprint: (c: object) => string }).fingerprint({}),
      expiresAt: new Date(Date.now() + 3600_000),
      rememberMe: true,
    }));
    const resolved = await serviceInstance.resolve("old-token", {});
    expect(resolved.id).toBe("active-id");
    expect(resolved.tokenFamily).toBe("family-id");
    expect(repository.revokeFamily).not.toHaveBeenCalled();
  });
});
