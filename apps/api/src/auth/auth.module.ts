import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { UserRepository } from "./user.repository";
import { PasswordPolicyService } from "./password-policy.service";
import { SensitiveActionGuard } from "./sensitive-action.guard";
import { TotpService } from "./totp.service";
import { EmailDeliveryService } from "./email-delivery.service";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    UserRepository,
    PasswordPolicyService,
    TotpService,
    SensitiveActionGuard,
    EmailDeliveryService,
  ],
  exports: [SensitiveActionGuard],
})
export class AuthModule {}
