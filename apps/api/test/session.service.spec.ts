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
      SESSION_SECRET: "a-session-secret-that-is-long-enough",
    }),
  );
}

describe("SessionService", () => {
  it("stores only a derived session identifier", async () => {
    let storedData: Record<string, unknown> = {};
    const repository = {
      create: vi
        .fn()
        .mockImplementation(
          (userId: string, sessionId: string, expiresAt: Date) => {
            storedData = { userId, sessionId, expiresAt };
            return { id: "record-id", ...storedData };
          },
        ),
    };
    const redis = { setWithTtl: vi.fn().mockResolvedValue(undefined) };
    const token = await makeService(repository, redis).create("user-id", {});
    expect(token).not.toBe(storedData.sessionId);
    expect(storedData.sessionId).toMatch(/^[a-f0-9]{64}$/);
    expect(redis.setWithTtl).toHaveBeenCalled();
  });

  it("removes an expired session from both stores", async () => {
    const repository = {
      findBySessionId: vi.fn().mockResolvedValue({
        id: "record-id",
        userId: "user-id",
        expiresAt: new Date(0),
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const redis = {
      get: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({ id: "record-id", userId: "user-id" }),
        ),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      makeService(repository, redis).resolve("raw-token"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(redis.delete).toHaveBeenCalled();
    expect(repository.delete).toHaveBeenCalled();
  });
});
