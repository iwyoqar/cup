import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Reads the Admin attached by AdminAuthGuard. Only usable on routes guarded by
// AdminAuthGuard — there is no fallback to a body/query-supplied adminId.
export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.admin;
});
