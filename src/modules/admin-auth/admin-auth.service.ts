import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AdminInactiveError, InvalidAdminCredentialsError } from './admin-auth.errors';
import { AdminSessionService } from './admin-session.service';
import { AdminsRepository } from './admins.repository';

export interface AdminProfileView {
  id: string;
  email: string;
  role: string;
}

export interface AdminAuthenticatedSession {
  sessionToken: string;
  admin: AdminProfileView;
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly adminsRepository: AdminsRepository,
    private readonly adminSessionService: AdminSessionService,
  ) {}

  async login(email: string, password: string): Promise<AdminAuthenticatedSession> {
    const admin = await this.adminsRepository.findByEmail(email);
    // Same error for "no such email" and "wrong password" — a login attempt must never be
    // able to distinguish whether an email exists in the system.
    if (!admin) {
      throw new InvalidAdminCredentialsError();
    }
    const passwordMatches = await bcrypt.compare(password, admin.passwordHash);
    if (!passwordMatches) {
      throw new InvalidAdminCredentialsError();
    }
    if (!admin.isActive) {
      throw new AdminInactiveError();
    }
    const sessionToken = this.adminSessionService.issue(admin.id, admin.role);
    return { sessionToken, admin: { id: admin.id, email: admin.email, role: admin.role } };
  }

  async getProfile(adminId: string): Promise<AdminProfileView> {
    const admin = await this.adminsRepository.findById(adminId);
    if (!admin) {
      throw new InvalidAdminCredentialsError();
    }
    return { id: admin.id, email: admin.email, role: admin.role };
  }
}
