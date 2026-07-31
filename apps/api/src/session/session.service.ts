import { createHmac, randomBytes } from "node:crypto";

import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { RequestMetadata } from "../common/request-context";
import { RedisService } from "../redis/redis.service";
import { SessionRepository } from "./session.repository";

interface CachedSession {
  id: string;
  userId: string;
}

@Injectable()
export class SessionService {
  static readonly cookieName = "sid";
  private readonly ttlSeconds: number;
  private readonly secret: string;

  constructor(
    private readonly repository: SessionRepository,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.ttlSeconds = config.getOrThrow<number>("SESSION_TTL");
    this.secret = config.getOrThrow<string>("SESSION_SECRET");
  }

  async create(userId: string, context: RequestMetadata): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const sessionId = this.hash(token);
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const session = await this.repository.create(
      userId,
      sessionId,
      expiresAt,
      context,
    );
    await this.redis.setWithTtl(
      this.key(sessionId),
      JSON.stringify({ id: session.id, userId } satisfies CachedSession),
      this.ttlSeconds,
    );
    return token;
  }

  async resolve(token: string): Promise<CachedSession> {
    const sessionId = this.hash(token);
    const cached = await this.redis.get(this.key(sessionId));
    if (!cached) {
      throw new UnauthorizedException("Session is invalid or expired");
    }
    const parsed = this.parseCachedSession(cached);
    const session = await this.repository.findBySessionId(sessionId);
    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.id !== parsed.id ||
      session.userId !== parsed.userId
    ) {
      await this.redis.delete(this.key(sessionId));
      if (session) await this.repository.delete(session.id);
      throw new UnauthorizedException("Session is invalid or expired");
    }
    await this.repository.touch(session.id);
    return parsed;
  }

  async destroy(token: string): Promise<void> {
    const sessionId = this.hash(token);
    await this.redis.delete(this.key(sessionId));
    await this.repository.deleteBySessionId(sessionId);
  }

  async refresh(token: string, context: RequestMetadata): Promise<string> {
    const current = await this.resolve(token);
    await this.destroy(token);
    return this.create(current.userId, context);
  }

  async list(userId: string) {
    return this.repository.listActive(userId);
  }

  async destroyByRecordId(userId: string, id: string): Promise<boolean> {
    const session = await this.repository.findOwned(id, userId);
    if (!session) return false;
    await this.redis.delete(this.key(session.sessionId));
    await this.repository.delete(id);
    return true;
  }

  async destroyAll(userId: string): Promise<void> {
    const sessions = await this.repository.listIdentifiers(userId);
    await this.redis.delete(
      ...sessions.map((session) => this.key(session.sessionId)),
    );
    await this.repository.deleteAll(userId);
  }

  private hash(token: string): string {
    return createHmac("sha256", this.secret).update(token).digest("hex");
  }

  private key(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private parseCachedSession(value: string): CachedSession {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (typeof parsed.id === "string" && typeof parsed.userId === "string") {
        return { id: parsed.id, userId: parsed.userId };
      }
    } catch {
      // Invalid cache entries are treated exactly like expired sessions.
    }
    throw new UnauthorizedException("Session is invalid or expired");
  }
}
