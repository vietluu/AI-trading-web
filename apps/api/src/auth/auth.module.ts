import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { UserRepository } from "./user.repository";
import { PasswordPolicyService } from "./password-policy.service";
import { SensitiveActionGuard } from "./sensitive-action.guard";
import { TotpService } from "./totp.service";
import { EmailDeliveryService } from "./email-delivery.service";
import { RecentAuthService } from "./recent-auth.service";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    UserRepository,
    PasswordPolicyService,
    TotpService,
    SensitiveActionGuard,
    EmailDeliveryService,
    RecentAuthService,
  ],
  exports: [
    SensitiveActionGuard,
    RecentAuthService,
    UserRepository,
    TotpService,
  ],
})
export class AuthModule {}
