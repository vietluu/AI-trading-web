import { ConfigService } from "@nestjs/config";
import { hash } from "argon2";
import { describe, expect, it, vi } from "vitest";

import { RecentAuthService } from "../src/auth/recent-auth.service";
import type { UserRepository } from "../src/auth/user.repository";
import type { RedisService } from "../src/redis/redis.service";

describe("RecentAuthService", () => {
  it("stores only a session-scoped proof after password verification", async () => {
    const passwordHash = await hash("Strong-Passphrase1!");
    const users = {
      findById: vi.fn().mockResolvedValue({ passwordHash }),
    } as unknown as UserRepository;
    const setWithTtl = vi.fn().mockResolvedValue(undefined);
    const redis = { setWithTtl } as unknown as RedisService;
    const service = new RecentAuthService(
      users,
      redis,
      new ConfigService({ EXCHANGE_RECENT_AUTH_TTL_SECONDS: 600 }),
    );
    await service.authenticate(
      "user-id",
      "session-record-id",
      "Strong-Passphrase1!",
    );
    expect(setWithTtl).toHaveBeenCalledWith(
      "recent-auth:session-record-id",
      "user-id",
      600,
    );
    expect(JSON.stringify(setWithTtl.mock.calls)).not.toContain(
      "Strong-Passphrase1!",
    );
  });
});
