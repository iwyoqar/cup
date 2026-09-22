import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { StaffActor } from './staff-auth.service';

export const CurrentStaff = createParamDecorator((_data: unknown, ctx: ExecutionContext): StaffActor => {
  return ctx.switchToHttp().getRequest().staff;
});
