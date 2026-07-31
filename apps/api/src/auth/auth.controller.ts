import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { CookieOptions, Request, Response } from "express";

import { AuditService } from "../audit/audit.service";
import {
  type AuthenticatedRequest,
  requestMetadata,
} from "../common/request-context";
import { SessionGuard } from "../session/session.guard";
import {
  type SessionCredentials,
  SessionService,
} from "../session/session.service";
import {
  ChangePasswordDto,
  DisableTotpDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ReauthenticateDto,
  ResetPasswordDto,
  TotpCodeDto,
  VerifyEmailDto,
} from "./auth.dto";
import { AuthService } from "./auth.service";
import { RecentAuthService } from "./recent-auth.service";

@ApiTags("authentication")
@Controller("auth")
export class AuthController {
  private readonly baseCookieOptions: CookieOptions;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly recentAuth: RecentAuthService,
    config: ConfigService,
  ) {
    const domain = config.get<string>("COOKIE_DOMAIN");
    this.baseCookieOptions = {
      sameSite: "lax",
      secure: config.getOrThrow<boolean>("COOKIE_SECURE"),
      ...(domain ? { domain } : {}),
      path: "/",
    };
  }

  @Post("register")
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.register(dto, requestMetadata(request));
    if (result.session) this.setCookies(response, result.session);
    return {
      ...result.user,
      requiresEmailVerification: result.requiresEmailVerification,
    };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto, requestMetadata(request));
    if (result.session) this.setCookies(response, result.session);
    return result.user;
  }

  @Post("logout")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SessionService.cookieName)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.destroy(request.auth.sessionToken);
    await this.audit.record(
      "LOGOUT",
      request.auth.userId,
      requestMetadata(request),
    );
    this.clearCookies(response);
  }

  @Post("refresh")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SessionService.cookieName)
  @HttpCode(HttpStatus.NO_CONTENT)
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.setCookies(
      response,
      await this.sessions.refresh(
        request.auth.sessionToken,
        requestMetadata(request),
      ),
    );
  }

  @Post("verify-email")
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Req() request: Request,
  ): Promise<void> {
    return this.auth.verifyEmail(dto.token, requestMetadata(request));
  }

  @Post("resend-verification")
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(
    @Body() dto: ForgotPasswordDto,
    @Req() request: Request,
  ) {
    await this.auth.resendEmailVerification(
      dto.email,
      requestMetadata(request),
    );
    return {
      message: "If verification is needed, a new email has been requested",
    };
  }

  @Post("forgot-password")
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: Request,
  ) {
    await this.auth.requestPasswordReset(dto.email, requestMetadata(request));
    return {
      message: "If that email exists, reset instructions have been requested",
    };
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() request: Request,
  ): Promise<void> {
    return this.auth.resetPassword(dto, requestMetadata(request));
  }

  @Post("change-password")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SessionService.cookieName)
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.setCookies(
      response,
      await this.auth.changePassword(
        request.auth.userId,
        dto,
        requestMetadata(request),
      ),
    );
  }

  @Get("me")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SessionService.cookieName)
  me(@Req() request: AuthenticatedRequest) {
    return this.auth.me(request.auth.userId);
  }

  @Get("session")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SessionService.cookieName)
  async currentSession(@Req() request: AuthenticatedRequest) {
    const current = (await this.sessions.list(request.auth.userId)).find(
      (item) => item.id === request.auth.sessionRecordId,
    );
    if (!current) throw new NotFoundException("Session not found");
    return { expiresAt: current.expiresAt, rememberMe: current.rememberMe };
  }

  @Get("sessions")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SessionService.cookieName)
  async listSessions(@Req() request: AuthenticatedRequest) {
    const sessions = await this.sessions.list(request.auth.userId);
    return sessions.map((session) => ({
      id: session.id,
      ip: session.ip,
      userAgent: session.userAgent,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      rememberMe: session.rememberMe,
      current: session.id === request.auth.sessionRecordId,
    }));
  }

  @Post("totp/setup")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SessionService.cookieName)
  beginTotp(@Req() request: AuthenticatedRequest) {
    return this.auth.beginTotpSetup(request.auth.userId);
  }

  @Post("reauthenticate")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SessionService.cookieName)
  @HttpCode(HttpStatus.OK)
  reauthenticate(
    @Body() dto: ReauthenticateDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ expiresAt: Date }> {
    return this.recentAuth.authenticate(
      request.auth.userId,
      request.auth.sessionRecordId,
      dto.password,
    );
  }

  @Post("totp/confirm")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SessionService.cookieName)
  @HttpCode(HttpStatus.NO_CONTENT)
  confirmTotp(
    @Body() dto: TotpCodeDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.auth.confirmTotpSetup(
      request.auth.userId,
      dto.code,
      requestMetadata(request),
    );
  }

  @Post("totp/disable")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SessionService.cookieName)
  @HttpCode(HttpStatus.NO_CONTENT)
  disableTotp(
    @Body() dto: DisableTotpDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.auth.disableTotp(
      request.auth.userId,
      dto.currentPassword,
      dto.code,
      requestMetadata(request),
    );
  }

  @Delete("sessions/:id")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SessionService.cookieName)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSession(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    if (!(await this.sessions.destroyByRecordId(request.auth.userId, id)))
      throw new NotFoundException("Session not found");
    await this.audit.record(
      "SESSION_REVOKE",
      request.auth.userId,
      requestMetadata(request),
      { sessionRecordId: id },
    );
    if (id === request.auth.sessionRecordId) this.clearCookies(response);
  }

  @Delete("sessions")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SessionService.cookieName)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAllSessions(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.destroyAll(request.auth.userId);
    await this.audit.record(
      "LOGOUT",
      request.auth.userId,
      requestMetadata(request),
      { allDevices: true },
    );
    this.clearCookies(response);
  }

  private setCookies(
    response: Response,
    credentials: SessionCredentials,
  ): void {
    const persistent = credentials.rememberMe
      ? { maxAge: Math.max(0, credentials.expiresAt.getTime() - Date.now()) }
      : {};
    response.cookie(SessionService.cookieName, credentials.token, {
      ...this.baseCookieOptions,
      ...persistent,
      httpOnly: true,
    });
    response.cookie(SessionService.csrfCookieName, credentials.csrfToken, {
      ...this.baseCookieOptions,
      ...persistent,
      httpOnly: false,
    });
  }

  private clearCookies(response: Response): void {
    response.clearCookie(SessionService.cookieName, {
      ...this.baseCookieOptions,
      httpOnly: true,
    });
    response.clearCookie(SessionService.csrfCookieName, {
      ...this.baseCookieOptions,
      httpOnly: false,
    });
  }
}
