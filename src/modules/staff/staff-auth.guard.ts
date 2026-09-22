import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InvalidStaffSessionError } from './staff-auth.errors';
import { StaffAuthService } from './staff-auth.service';
import { StaffSessionService } from './staff-session.service';

// Guards /staff/* only. Customer JWTs and admin JWTs are signed with different keys and have no staff
// audience, so they fail verification here; and this guard is not applied to any admin/customer route.
@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: StaffSessionService,
    private readonly staffAuthService: StaffAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) throw new InvalidStaffSessionError('Missing staff session token.');
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new InvalidStaffSessionError('Missing staff session token.');

    const payload = this.sessions.verify(token);
    const actor = await this.staffAuthService.resolveActor(payload.kind, payload.sub);
    if (!actor) throw new InvalidStaffSessionError('Session refers to an inactive or unknown account.');
    request.staff = actor;
    return true;
  }
}
