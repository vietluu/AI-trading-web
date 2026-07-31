import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Response } from "express";
import { ConfigService } from "@nestjs/config";

import type { AuthenticatedRequest } from "../common/request-context";
import { requestMetadata } from "../common/request-context";
import { SessionService } from "./session.service";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly config?: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.readCookie(
      request.headers.cookie,
      SessionService.cookieName,
    );
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      this.clearResponseCookies(context.switchToHttp().getResponse<Response>());
      throw new UnauthorizedException("Authentication required");
    }
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(
      request.method ?? "GET",
    );
    const csrfCookie = this.readCookie(
      request.headers.cookie,
      SessionService.csrfCookieName,
    );
    const csrfHeader = request.get(SessionService.csrfHeaderName);
    if (unsafe && (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader)) {
      throw new ForbiddenException("CSRF validation failed");
    }
    let session: { id: string; userId: string };
    try {
      session = await this.sessions.resolve(
        token,
        requestMetadata(request),
        unsafe ? csrfHeader : undefined,
      );
    } catch (error) {
      const response = context.switchToHttp().getResponse<Response>();
      this.clearResponseCookies(response);
      throw error;
    }
    (request as AuthenticatedRequest).auth = {
      userId: session.userId,
      sessionRecordId: session.id,
      sessionToken: token,
    };
    return true;
  }

  private clearResponseCookies(response: Response): void {
    const domain = this.config?.get<string>("COOKIE_DOMAIN");
    const options = {
      path: "/",
      sameSite: "lax" as const,
      secure: this.config?.get<boolean>("COOKIE_SECURE") ?? false,
      ...(domain ? { domain } : {}),
    };
    response.clearCookie(SessionService.cookieName, {
      ...options,
      httpOnly: true,
    });
    response.clearCookie(SessionService.csrfCookieName, {
      ...options,
      httpOnly: false,
    });
  }

  private readCookie(
    header: string | undefined,
    name: string,
  ): string | undefined {
    return header
      ?.split(";")
      .map((part) => part.trim().split("="))
      .find(([key]) => key === name)
      ?.slice(1)
      .join("=");
  }
}
