import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Reads the Customer attached by AuthGuard. Only usable on routes guarded by AuthGuard —
// there is no fallback to a body/query-supplied customerId.
export const CurrentCustomer = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.customer;
});
