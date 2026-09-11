import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { RequestMetadata } from "../common/request-context";
import { RedisService } from "../redis/redis.service";
import { SessionRepository } from "./session.repository";

interface CachedSession {
  id: string;
  userId: string;
  tokenFamily: string;
  generation: number;
  csrfHash: string;
  fingerprint: string;
  expiresAt: string;
  rememberMe: boolean;
}

export interface SessionCredentials {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  rememberMe: boolean;
}

@Injectable()
export class SessionService {
  static readonly cookieName = "sid";
  static readonly csrfCookieName = "csrf_token";
  static readonly csrfHeaderName = "x-csrf-token";
  static readonly rotationGracePeriodMs = 30_000;
  private readonly ttlSeconds: number;
  private readonly rememberMeTtlSeconds: number;
  private readonly secret: string;
  private readonly fingerprintEnabled: boolean;
  private readonly fingerprintBindIp: boolean;

  constructor(
    private readonly repository: SessionRepository,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.ttlSeconds = config.getOrThrow<number>("SESSION_TTL");
    this.rememberMeTtlSeconds =
      config.get<number>("REMEMBER_ME_TTL") ?? 2_592_000;
    this.secret = config.getOrThrow<string>("SESSION_SECRET");
    this.fingerprintEnabled =
      config.get<boolean>("SESSION_FINGERPRINT_ENABLED") ?? true;
    this.fingerprintBindIp =
      config.get<boolean>("SESSION_FINGERPRINT_BIND_IP") ?? false;
  }

  async create(
    userId: string,
    context: RequestMetadata,
    rememberMe = false,
  ): Promise<SessionCredentials> {
    return this.issue(
      userId,
      context,
      rememberMe,
      randomBytes(16).toString("hex"),
      0,
    );
  }

  async resolve(
    token: string,
    context: RequestMetadata,
    csrfToken?: string,
  ): Promise<CachedSession> {
    const sessionId = this.hash(`session:${token}`);
    const cached = await this.redis.get(this.key(sessionId));
    let parsed: CachedSession | undefined;

    if (cached) {
      parsed = this.parseCachedSession(cached);
    }

    const session = await this.repository.findBySessionId(sessionId);
    if (!session || session.expiresAt <= new Date()) {
      await this.redis.delete(this.key(sessionId));
      if (session && !session.revokedAt)
        await this.repository.revoke(session.id);
      throw new UnauthorizedException("Session is invalid or expired");
    }

    if (session.revokedAt) {
      // Check if this session was rotated within the concurrency grace period
      if (
        session.rotatedAt &&
        Date.now() - session.rotatedAt.getTime() <= SessionService.rotationGracePeriodMs
      ) {
        const active = await this.repository.findActiveByFamily(session.tokenFamily);
        if (active && active.expiresAt > new Date()) {
          const fingerprint = this.fingerprint(context);
          if (
            this.fingerprintEnabled &&
            !this.constantEqual(active.fingerprint, fingerprint)
          ) {
            await this.destroyFamily(active.tokenFamily);
            throw new UnauthorizedException("Session device fingerprint changed");
          }
          if (
            csrfToken &&
            !this.constantEqual(active.csrfHash, this.hash(`csrf:${csrfToken}`))
          ) {
            throw new UnauthorizedException("CSRF validation failed");
          }
          return {
            id: active.id,
            userId: active.userId,
            tokenFamily: active.tokenFamily,
            generation: active.generation,
            csrfHash: active.csrfHash,
            fingerprint: active.fingerprint,
            expiresAt: active.expiresAt.toISOString(),
            rememberMe: active.rememberMe,
          };
        }
      }
      await this.redis.delete(this.key(sessionId));
      if (
        session.rotatedAt &&
        Date.now() - session.rotatedAt.getTime() > SessionService.rotationGracePeriodMs
      ) {
        await this.destroyFamily(session.tokenFamily);
      }
      throw new UnauthorizedException("Session is invalid or expired");
    }

    if (!parsed) {
      if (session.rotatedAt) {
        if (
          Date.now() - session.rotatedAt.getTime() >
          SessionService.rotationGracePeriodMs
        ) {
          await this.destroyFamily(session.tokenFamily);
        }
        throw new UnauthorizedException("Session is invalid or expired");
      }

      parsed = {
        id: session.id,
        userId: session.userId,
        tokenFamily: session.tokenFamily,
        generation: session.generation,
        csrfHash: session.csrfHash,
        fingerprint: session.fingerprint,
        expiresAt: session.expiresAt.toISOString(),
        rememberMe: session.rememberMe,
      };
      await this.redis.setWithTtl(
        this.key(sessionId),
        JSON.stringify(parsed),
        Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
      );
    }

    if (parsed.id !== session.id || parsed.userId !== session.userId) {
      await this.redis.delete(this.key(sessionId));
      throw new UnauthorizedException("Session is invalid or expired");
    }

    const fingerprint = this.fingerprint(context);
    if (
      this.fingerprintEnabled &&
      !this.constantEqual(session.fingerprint, fingerprint)
    ) {
      await this.destroyFamily(session.tokenFamily);
      throw new UnauthorizedException("Session device fingerprint changed");
    }
    if (
      csrfToken &&
      !this.constantEqual(session.csrfHash, this.hash(`csrf:${csrfToken}`))
    ) {
      throw new UnauthorizedException("CSRF validation failed");
    }
    await this.repository.touch(session.id);
    return parsed;
  }

  async destroy(token: string): Promise<void> {
    const sessionId = this.hash(`session:${token}`);
    await this.redis.delete(this.key(sessionId));
    await this.repository.revokeBySessionId(sessionId);
  }

  async refresh(
    token: string,
    context: RequestMetadata,
  ): Promise<SessionCredentials> {
    const sessionId = this.hash(`session:${token}`);
    const existing = await this.repository.findBySessionId(sessionId);

    // If already rotated within the concurrency grace period, return cached grace credentials
    if (
      existing?.rotatedAt &&
      Date.now() - existing.rotatedAt.getTime() <= SessionService.rotationGracePeriodMs
    ) {
      const graceCached = await this.redis.get(this.graceKey(existing.tokenFamily));
      if (graceCached) {
        try {
          const parsedGrace = JSON.parse(graceCached) as {
            token: string;
            csrfToken: string;
            expiresAt: string;
            rememberMe: boolean;
          };
          return {
            token: parsedGrace.token,
            csrfToken: parsedGrace.csrfToken,
            expiresAt: new Date(parsedGrace.expiresAt),
            rememberMe: parsedGrace.rememberMe,
          };
        } catch {
          // fallback to standard issue
        }
      }
    }

    const current = await this.resolve(token, context);
    const next = await this.issue(
      current.userId,
      context,
      current.rememberMe,
      current.tokenFamily,
      current.generation + 1,
      current.id,
    );
    await this.redis.delete(this.key(sessionId));
    await this.redis.setWithTtl(
      this.graceKey(current.tokenFamily),
      JSON.stringify({
        token: next.token,
        csrfToken: next.csrfToken,
        expiresAt: next.expiresAt.toISOString(),
        rememberMe: next.rememberMe,
      }),
      Math.round(SessionService.rotationGracePeriodMs / 1000),
    );
    return next;
  }

  async list(userId: string) {
    return this.repository.listActive(userId);
  }

  async destroyByRecordId(userId: string, id: string): Promise<boolean> {
    const session = await this.repository.findOwned(id, userId);
    if (!session || session.revokedAt) return false;
    await this.redis.delete(this.key(session.sessionId));
    await this.repository.revoke(id);
    return true;
  }

  async destroyAll(userId: string): Promise<void> {
    const sessions = await this.repository.listIdentifiers(userId);
    await this.redis.delete(
      ...sessions.map((session) => this.key(session.sessionId)),
    );
    await this.repository.revokeAll(userId);
  }

  private async issue(
    userId: string,
    context: RequestMetadata,
    rememberMe: boolean,
    tokenFamily: string,
    generation: number,
    rotateId?: string,
  ): Promise<SessionCredentials> {
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const sessionId = this.hash(`session:${token}`);
    const ttl = rememberMe ? this.rememberMeTtlSeconds : this.ttlSeconds;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const data = {
      userId,
      sessionId,
      tokenFamily,
      generation,
      csrfHash: this.hash(`csrf:${csrfToken}`),
      fingerprint: this.fingerprint(context),
      rememberMe,
      expiresAt,
      context,
    };
    const session = rotateId
      ? await this.repository.rotate(rotateId, data)
      : await this.repository.create(data);
    if (!session) {
      if (rotateId) {
        const existing = await this.repository.findOwned(rotateId, userId);
        if (
          existing?.rotatedAt &&
          Date.now() - existing.rotatedAt.getTime() <= SessionService.rotationGracePeriodMs
        ) {
          const active = await this.repository.findActiveByFamily(tokenFamily);
          if (active) {
            return {
              token,
              csrfToken,
              expiresAt,
              rememberMe,
            };
          }
        }
      }
      await this.destroyFamily(tokenFamily);
      throw new UnauthorizedException("Session rotation conflict detected");
    }
    const cached: CachedSession = {
      id: session.id,
      userId,
      tokenFamily,
      generation,
      csrfHash: data.csrfHash,
      fingerprint: data.fingerprint,
      expiresAt: expiresAt.toISOString(),
      rememberMe,
    };
    await this.redis.setWithTtl(
      this.key(sessionId),
      JSON.stringify(cached),
      ttl,
    );
    return { token, csrfToken, expiresAt, rememberMe };
  }

  private graceKey(tokenFamily: string): string {
    return `session:grace:${tokenFamily}`;
  }

  private async handlePossibleReuse(sessionId: string): Promise<void> {
    const session = await this.repository.findBySessionId(sessionId);
    if (session?.rotatedAt) await this.destroyFamily(session.tokenFamily);
  }

  private async destroyFamily(tokenFamily: string): Promise<void> {
    const sessions = await this.repository.listFamilyIdentifiers(tokenFamily);
    await this.redis.delete(
      ...sessions.map((item) => this.key(item.sessionId)),
    );
    await this.repository.revokeFamily(tokenFamily);
  }

  private fingerprint(context: RequestMetadata): string {
    const userAgent = (context.userAgent ?? "unknown").trim().toLowerCase();
    const ip = this.fingerprintBindIp
      ? this.ipPrefix(context.ip)
      : "ip-unbound";
    return this.hash(`fingerprint:${userAgent}:${ip}`);
  }

  private ipPrefix(ip?: string): string {
    if (!ip) return "unknown";
    if (ip.includes(".")) return ip.split(".").slice(0, 3).join(".");
    return ip.split(":").slice(0, 4).join(":");
  }

  private hash(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("hex");
  }

  private constantEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private key(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private parseCachedSession(value: string): CachedSession {
    try {
      const parsed = JSON.parse(value) as CachedSession;
      if (
        typeof parsed.id === "string" &&
        typeof parsed.userId === "string" &&
        typeof parsed.tokenFamily === "string" &&
        typeof parsed.generation === "number" &&
        typeof parsed.csrfHash === "string" &&
        typeof parsed.fingerprint === "string" &&
        typeof parsed.expiresAt === "string" &&
        typeof parsed.rememberMe === "boolean"
      )
        return parsed;
    } catch {
      // Invalid cache entries are treated exactly like expired sessions.
    }
    throw new UnauthorizedException("Session is invalid or expired");
  }
}
