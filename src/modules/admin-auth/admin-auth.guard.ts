import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AdminInactiveError, InvalidAdminSessionError } from './admin-auth.errors';
import { AdminSessionService } from './admin-session.service';
import { AdminsRepository } from './admins.repository';

// Mirrors the customer AuthGuard's shape exactly, but resolves identity strictly through
// AdminSessionService (ADMIN_JWT_SECRET) and AdminsRepository — structurally cannot accept a
// customer session token, since that token was never signed with this secret in the first
// place. Attaches request.admin, never request.customer; no endpoint using this guard can be
// asked to act "as" a customer or another admin.
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly adminSessionService: AdminSessionService,
    private readonly adminsRepository: AdminsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new InvalidAdminSessionError('Missing admin session token.');
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw new InvalidAdminSessionError('Missing admin session token.');
    }

    const payload = this.adminSessionService.verify(token);
    const admin = await this.adminsRepository.findById(payload.sub);
    if (!admin) {
      throw new InvalidAdminSessionError('Session refers to an unknown admin.');
    }
    if (!admin.isActive) {
      throw new AdminInactiveError();
    }

    request.admin = { id: admin.id, role: admin.role };
    return true;
  }
}
