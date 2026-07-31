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
import { SessionService } from "../session/session.service";
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from "./auth.dto";
import { AuthService } from "./auth.service";

@ApiTags("authentication")
@Controller("auth")
export class AuthController {
  private readonly cookieOptions: CookieOptions;
  private readonly clearCookieOptions: CookieOptions;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    const domain = config.get<string>("COOKIE_DOMAIN");
    this.clearCookieOptions = {
      httpOnly: true,
      sameSite: "lax",
      secure: config.getOrThrow<boolean>("COOKIE_SECURE"),
      ...(domain ? { domain } : {}),
      path: "/",
    };
    this.cookieOptions = {
      ...this.clearCookieOptions,
      maxAge: config.getOrThrow<number>("SESSION_TTL") * 1000,
    };
  }

  @Post("register")
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.register(dto, requestMetadata(request));
    this.setCookie(response, result.token);
    return result.user;
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto, requestMetadata(request));
    this.setCookie(response, result.token);
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
    response.clearCookie(SessionService.cookieName, this.clearCookieOptions);
  }

  @Post("refresh")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SessionService.cookieName)
  @HttpCode(HttpStatus.NO_CONTENT)
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.setCookie(
      response,
      await this.sessions.refresh(
        request.auth.sessionToken,
        requestMetadata(request),
      ),
    );
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
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.resetPassword(dto, requestMetadata(request));
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
    this.setCookie(
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
      current: session.id === request.auth.sessionRecordId,
    }));
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
    if (!(await this.sessions.destroyByRecordId(request.auth.userId, id))) {
      throw new NotFoundException("Session not found");
    }
    await this.audit.record(
      "SESSION_REVOKE",
      request.auth.userId,
      requestMetadata(request),
      { sessionRecordId: id },
    );
    if (id === request.auth.sessionRecordId) {
      response.clearCookie(SessionService.cookieName, this.clearCookieOptions);
    }
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
    response.clearCookie(SessionService.cookieName, this.clearCookieOptions);
  }

  private setCookie(response: Response, token: string): void {
    response.cookie(SessionService.cookieName, token, this.cookieOptions);
  }
}
