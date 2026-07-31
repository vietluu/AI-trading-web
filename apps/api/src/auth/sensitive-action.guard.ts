import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AuthenticatedRequest } from "../common/request-context";
import { TotpService } from "./totp.service";
import { UserRepository } from "./user.repository";

@Injectable()
export class SensitiveActionGuard implements CanActivate {
  private readonly required: boolean;

  constructor(
    private readonly users: UserRepository,
    private readonly totp: TotpService,
    config: ConfigService,
  ) {
    this.required =
      config.get<boolean>("TOTP_REQUIRED_FOR_SENSITIVE_ACTIONS") ?? false;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.users.findById(request.auth.userId);
    if (!user) throw new UnauthorizedException("User no longer exists");
    if (!user.totpSecret || !user.totpEnabledAt) {
      if (this.required)
        throw new ForbiddenException("Enable two-factor authentication first");
      return true;
    }
    const code = request.get("x-totp-code");
    if (
      !code ||
      !this.totp.verify(this.totp.decrypt(user.totpSecret, user.id), code)
    ) {
      throw new ForbiddenException("A valid two-factor code is required");
    }
    return true;
  }
}
