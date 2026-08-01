import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type AuthenticatedRequest } from '../request-context';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth?.userId) return undefined;
    return { id: request.auth.userId };
  },
);
