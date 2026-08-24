import { createHash, randomBytes } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { User } from "@prisma/client";
import { argon2id, hash, verify } from "argon2";

import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../common/request-context";
import { RedisService } from "../redis/redis.service";
import {
  type SessionCredentials,
  SessionService,
} from "../session/session.service";
import type {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from "./auth.dto";
import { PasswordPolicyService } from "./password-policy.service";
import { TotpService } from "./totp.service";
import { UserRepository } from "./user.repository";
import { EmailDeliveryService } from "./email-delivery.service";

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  emailVerified: boolean;
  totpEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthenticationResult {
  user: PublicUser;
  session?: SessionCredentials;
  requiresEmailVerification: boolean;
  requiresTotp?: boolean;
}

@Injectable()
export class AuthService {
  private readonly emailVerificationEnabled: boolean;

  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordPolicyService,
    private readonly totp: TotpService,
    private readonly emailDelivery: EmailDeliveryService,
    config: ConfigService,
  ) {
    this.emailVerificationEnabled =
      config.get<boolean>("EMAIL_VERIFICATION_ENABLED") ?? false;
  }

  async register(
    dto: RegisterDto,
    context: RequestMetadata,
  ): Promise<AuthenticationResult> {
    const existing = await this.users.findByIdentifier(dto.email);
    const usernameExists = await this.users.findByIdentifier(dto.username);
    if (existing || usernameExists) {
      throw new ConflictException("Email or username is already registered");
    }
    await this.passwords.assertStrong(dto.password, [
      dto.email.split("@")[0] ?? "",
      dto.username,
    ]);
    const user = await this.users.create(
      dto.email,
      dto.username,
      await hash(dto.password, { type: argon2id }),
      this.emailVerificationEnabled ? null : new Date(),
    );
    if (this.emailVerificationEnabled)
      await this.issueEmailVerification(user, context);
    const session = this.emailVerificationEnabled
      ? undefined
      : await this.sessions.create(user.id, context);
    await this.audit.record("REGISTER", user.id, context);
    return {
      user: this.publicUser(user),
      ...(session ? { session } : {}),
      requiresEmailVerification: this.emailVerificationEnabled,
    };
  }

  async login(
    dto: LoginDto,
    context: RequestMetadata,
  ): Promise<AuthenticationResult> {
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
    if (this.emailVerificationEnabled && !user.emailVerifiedAt) {
      throw new ForbiddenException("Verify your email before signing in");
    }

    if (user.totpEnabledAt && user.totpSecret) {
      if (!dto.code) {
        return {
          user: this.publicUser(user),
          requiresEmailVerification: false,
          requiresTotp: true,
        };
      }
      const decryptedSecret = this.totp.decrypt(user.totpSecret, user.id);
      if (!this.totp.verify(decryptedSecret, dto.code)) {
        throw new UnauthorizedException("Invalid 2FA code");
      }
    }

    await this.users.clearFailedLogins(user.id);
    await this.redis.delete(rateLimitKey);
    const rememberMe = Boolean(dto.rememberMe);
    const session = await this.sessions.create(user.id, context, rememberMe);
    await this.audit.record("LOGIN", user.id, context, { rememberMe });
    return {
      user: this.publicUser(user),
      session,
      requiresEmailVerification: false,
    };
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException("User no longer exists");
    return this.publicUser(user);
  }

  async verifyEmail(token: string, context: RequestMetadata): Promise<void> {
    const userId = await this.redis.getAndDelete(
      `email-verification:${this.tokenHash(token)}`,
    );
    if (!userId)
      throw new UnauthorizedException(
        "Verification token is invalid or expired",
      );
    await this.users.markEmailVerified(userId);
    await this.audit.record("EMAIL_VERIFIED", userId, context);
  }

  async resendEmailVerification(
    email: string,
    context: RequestMetadata,
  ): Promise<void> {
    if (!this.emailVerificationEnabled) return;
    const user = await this.users.findByEmail(email);
    if (user && !user.emailVerifiedAt)
      await this.issueEmailVerification(user, context);
  }

  async requestPasswordReset(
    email: string,
    context: RequestMetadata,
  ): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const requestHash = this.tokenHash(normalizedEmail);
    const allowed = await this.redis.setNx(
      `password-reset-request:${requestHash}`,
      "1",
      60,
    );
    if (!allowed) return;
    const user = await this.users.findByEmail(normalizedEmail);
    if (!user) return;
    const token = randomBytes(32).toString("base64url");
    const hash = this.tokenHash(token);
    const key = `password-reset:${hash}`;
    const pointerKey = `password-reset-user:${user.id}`;
    const previousHash = await this.redis.get(pointerKey);
    if (previousHash) await this.redis.delete(`password-reset:${previousHash}`);
    await this.redis.setWithTtl(
      key,
      user.id,
      900,
    );
    await this.redis.setWithTtl(pointerKey, hash, 900);
    try {
      await this.emailDelivery.send("RESET_PASSWORD", user.email, token);
    } catch {
      await this.redis.delete(key, pointerKey);
      await this.audit.record("AUTH_EMAIL_DELIVERY_FAILED", user.id, context, {
        type: "RESET_PASSWORD",
      });
    }
    await this.audit.record("PASSWORD_RESET_REQUEST", user.id, context);
  }

  async resetPassword(
    dto: ResetPasswordDto,
    context: RequestMetadata,
  ): Promise<void> {
    const tokenHash = this.tokenHash(dto.token);
    const key = `password-reset:${tokenHash}`;
    const userId = await this.redis.get(key);
    if (!userId)
      throw new UnauthorizedException("Reset token is invalid or expired");
    const user = await this.users.findById(userId);
    if (!user)
      throw new UnauthorizedException("Reset token is invalid or expired");
    await this.passwords.assertStrong(dto.newPassword, [
      user.email.split("@")[0] ?? "",
      user.username,
    ]);
    const consumedUserId = await this.redis.consumeLinkedToken(
      key,
      `password-reset-user:${userId}`,
      tokenHash,
    );
    if (consumedUserId !== userId) {
      throw new UnauthorizedException("Reset token is invalid or expired");
    }
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
  ): Promise<SessionCredentials> {
    const user = await this.users.findById(userId);
    if (!user || !(await verify(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException("Current password is incorrect");
    }
    await this.passwords.assertStrong(dto.newPassword, [
      user.email.split("@")[0] ?? "",
      user.username,
    ]);
    await this.users.updatePassword(
      userId,
      await hash(dto.newPassword, { type: argon2id }),
    );
    await this.sessions.destroyAll(userId);
    const session = await this.sessions.create(userId, context);
    await this.audit.record("PASSWORD_CHANGE", userId, context);
    return session;
  }

  async beginTotpSetup(
    userId: string,
  ): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException("User no longer exists");
    const secret = this.totp.createSecret();
    await this.redis.setWithTtl(
      `totp-setup:${userId}`,
      this.totp.encrypt(secret, userId),
      600,
    );
    return { secret, otpauthUri: this.totp.uri(secret, user.email) };
  }

  async confirmTotpSetup(
    userId: string,
    code: string,
    context: RequestMetadata,
  ): Promise<void> {
    const pending = await this.redis.get(`totp-setup:${userId}`);
    if (!pending) throw new UnauthorizedException("Two-factor setup expired");
    const secret = this.totp.decrypt(pending, userId);
    if (!this.totp.verify(secret, code))
      throw new UnauthorizedException("Invalid two-factor code");
    await this.users.enableTotp(userId, this.totp.encrypt(secret, userId));
    await this.redis.delete(`totp-setup:${userId}`);
    await this.audit.record("TOTP_ENABLED", userId, context);
  }

  async disableTotp(
    userId: string,
    currentPassword: string,
    code: string,
    context: RequestMetadata,
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (
      !user ||
      !user.totpSecret ||
      !(await verify(user.passwordHash, currentPassword))
    ) {
      throw new UnauthorizedException(
        "Password or two-factor code is incorrect",
      );
    }
    if (!this.totp.verify(this.totp.decrypt(user.totpSecret, userId), code)) {
      throw new UnauthorizedException(
        "Password or two-factor code is incorrect",
      );
    }
    await this.users.disableTotp(userId);
    await this.audit.record("TOTP_DISABLED", userId, context);
  }

  private async issueEmailVerification(
    user: User,
    context: RequestMetadata,
  ): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.redis.setWithTtl(
      `email-verification:${this.tokenHash(token)}`,
      user.id,
      86_400,
    );
    try {
      await this.emailDelivery.send("VERIFY_EMAIL", user.email, token);
    } catch {
      await this.audit.record("AUTH_EMAIL_DELIVERY_FAILED", user.id, context, {
        type: "VERIFY_EMAIL",
      });
    }
    await this.audit.record("EMAIL_VERIFICATION_REQUEST", user.id, context);
    // The caller hands this token to the configured mail adapter; it is never logged.
    return token;
  }

  private tokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private publicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      emailVerified: Boolean(user.emailVerifiedAt),
      totpEnabled: Boolean(user.totpEnabledAt),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
