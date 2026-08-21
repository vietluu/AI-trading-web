import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { AuthenticatedRequest } from "../../../common/request-context";
import { RedisService } from "../../../redis/redis.service";

@Injectable()
export class ResearchRateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    const userId = request.auth?.userId;
    if (!userId) throw new ServiceUnavailableException("Authenticated research context unavailable");
    const minute = Math.floor(Date.now() / 60_000);
    const count = await this.redis.incrementWithTtl(`research:rate:${userId}:${minute}`, 120);
    if (count > 12) {
      throw new HttpException("Research request rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
