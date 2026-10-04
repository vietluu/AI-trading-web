import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';

/** No admin role exists yet. Deployment configuration is the only control plane. */
@Injectable()
export class PlatformAIGuard implements CanActivate {
  canActivate(): never {
    throw new ForbiddenException('AI infrastructure is managed by the platform');
  }
}
