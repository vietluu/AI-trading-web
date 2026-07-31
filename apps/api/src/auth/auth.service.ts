import { createHash, randomBytes } from "node:crypto";

import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { argon2id, hash, verify } from "argon2";

import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../common/request-context";
import { RedisService } from "../redis/redis.service";
import { SessionService } from "../session/session.service";
import type {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from "./auth.dto";
import { UserRepository } from "./user.repository";

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async register(
    dto: RegisterDto,
    context: RequestMetadata,
  ): Promise<{ user: PublicUser; token: string }> {
    const existing = await this.users.findByIdentifier(dto.email);
    const usernameExists = await this.users.findByIdentifier(dto.username);
    if (existing || usernameExists)
      throw new ConflictException("Email or username is already registered");
    const user = await this.users.create(
      dto.email,
      dto.username,
      await hash(dto.password, { type: argon2id }),
    );
    const token = await this.sessions.create(user.id, context);
    await this.audit.record("REGISTER", user.id, context);
    return { user: this.publicUser(user), token };
  }

  async login(
    dto: LoginDto,
    context: RequestMetadata,
  ): Promise<{ user: PublicUser; token: string }> {
    const rateLimitKey = `login-attempt:${this.tokenHash(`${context.ip ?? "unknown"}:${dto.identifier.toLowerCase()}`)}`;
    const attempts = await this.redis.get(rateLimitKey);
    if (attempts && Number(attempts) >= 5) {
      throw new HttpException(
        "Too many login attempts; try again later",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.users.findByIdentifier(dto.identifier);
    if (!user) {
      await hash(dto.password, { type: argon2id });
      await this.redis.incrementWithTtl(rateLimitKey, 900);
      throw new UnauthorizedException("Invalid credentials");
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        "Account temporarily locked; try again later",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!(await verify(user.passwordHash, dto.password))) {
      await this.redis.incrementWithTtl(rateLimitKey, 900);
      await this.users.recordFailedLogin(user);
      throw new UnauthorizedException("Invalid credentials");
    }
    await this.users.clearFailedLogins(user.id);
    await this.redis.delete(rateLimitKey);
    const token = await this.sessions.create(user.id, context);
    await this.audit.record("LOGIN", user.id, context);
    return { user: this.publicUser(user), token };
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException("User no longer exists");
    return this.publicUser(user);
  }

  async requestPasswordReset(
    email: string,
    context: RequestMetadata,
  ): Promise<string | undefined> {
    const user = await this.users.findByEmail(email);
    if (!user) return undefined;
    const token = randomBytes(32).toString("base64url");
    await this.redis.setWithTtl(
      `password-reset:${this.tokenHash(token)}`,
      user.id,
      900,
    );
    await this.audit.record("PASSWORD_RESET_REQUEST", user.id, context);
    // Delivery is intentionally delegated to a mail provider adapter; raw reset tokens are never logged.
    return token;
  }

  async resetPassword(
    dto: ResetPasswordDto,
    context: RequestMetadata,
  ): Promise<void> {
    const key = `password-reset:${this.tokenHash(dto.token)}`;
    const userId = await this.redis.getAndDelete(key);
    if (!userId)
      throw new UnauthorizedException("Reset token is invalid or expired");
    await this.users.updatePassword(
      userId,
      await hash(dto.newPassword, { type: argon2id }),
    );
    await this.sessions.destroyAll(userId);
    await this.audit.record("PASSWORD_RESET", userId, context);
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    context: RequestMetadata,
  ): Promise<string> {
    const user = await this.users.findById(userId);
    if (!user || !(await verify(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException("Current password is incorrect");
    }
    await this.users.updatePassword(
      userId,
      await hash(dto.newPassword, { type: argon2id }),
    );
    await this.sessions.destroyAll(userId);
    const token = await this.sessions.create(userId, context);
    await this.audit.record("PASSWORD_CHANGE", userId, context);
    return token;
  }

  private tokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private publicUser(user: PublicUser): PublicUser {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
