import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";

import type { AuthenticatedRequest } from "../common/request-context";
import { SessionService } from "./session.service";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.readCookie(
      request.headers.cookie,
      SessionService.cookieName,
    );
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new UnauthorizedException("Authentication required");
    }
    const session = await this.sessions.resolve(token);
    (request as AuthenticatedRequest).auth = {
      userId: session.userId,
      sessionRecordId: session.id,
      sessionToken: token,
    };
    return true;
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
