import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { verify } from "argon2";

import { RedisService } from "../redis/redis.service";
import { UserRepository } from "./user.repository";

@Injectable()
export class RecentAuthService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly users: UserRepository,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.ttlSeconds =
      config.get<number>("EXCHANGE_RECENT_AUTH_TTL_SECONDS") ?? 600;
  }

  async authenticate(
    userId: string,
    sessionRecordId: string,
    password: string,
  ): Promise<{ expiresAt: Date }> {
    const user = await this.users.findById(userId);
    if (!user || !(await verify(user.passwordHash, password))) {
      throw new UnauthorizedException("Password is incorrect");
    }
    await this.redis.setWithTtl(
      this.key(sessionRecordId),
      userId,
      this.ttlSeconds,
    );
    return { expiresAt: new Date(Date.now() + this.ttlSeconds * 1000) };
  }

  async assertRecent(userId: string, sessionRecordId: string): Promise<void> {
    if ((await this.redis.get(this.key(sessionRecordId))) !== userId) {
      throw new ForbiddenException(
        "Recent password authentication is required",
      );
    }
  }

  private key(sessionRecordId: string): string {
    return `recent-auth:${sessionRecordId}`;
  }
}
