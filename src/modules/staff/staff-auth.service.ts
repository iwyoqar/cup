import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AdminsRepository } from '../admin-auth/admins.repository';
import { InvalidStaffCredentialsError, StaffLoginThrottledError } from './staff-auth.errors';
import { isAdminRole } from './staff-roles';
import { StaffActorKind, StaffSessionService } from './staff-session.service';
import { StaffRepository } from './staff.repository';

export interface StaffActor {
  kind: StaffActorKind;
  id: string;
  role: 'STAFF' | 'ADMIN';
  displayName: string;
  branch: { id: string; name: string } | null;
}

export interface StaffAuthenticatedSession {
  sessionToken: string;
  staff: StaffActor;
}

// A well-formed bcrypt hash that no real password matches — compared against when the account does
// not exist, so "unknown user" and "wrong password" take comparable time.
const DUMMY_HASH = bcrypt.hashSync('cup-staff-timing-equalizer', 10);

const MAX_FAILURES = 8;
const LOCK_MS = 10 * 60 * 1000;

@Injectable()
export class StaffAuthService {
  // Small in-memory brute-force guard, per identifier. Resets on restart, which is acceptable for a
  // single-instance deployment; a shared store would replace it for multi-instance.
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly staffRepository: StaffRepository,
    private readonly adminsRepository: AdminsRepository,
    private readonly sessions: StaffSessionService,
  ) {}

  async login(identifierRaw: string, password: string): Promise<StaffAuthenticatedSession> {
    const identifier = identifierRaw.trim().toLowerCase();
    this.assertNotThrottled(identifier);

    const actor = await this.tryAuthenticate(identifier, password);
    if (!actor) {
      this.recordFailure(identifier);
      throw new InvalidStaffCredentialsError();
    }
    this.failures.delete(identifier);
    return { sessionToken: this.sessions.issue(actor.kind, actor.id), staff: actor };
  }

  // Resolves the CURRENT actor behind a verified token (used by the guard on every request, so a
  // deactivated account loses access immediately).
  async resolveActor(kind: StaffActorKind, id: string): Promise<StaffActor | null> {
    if (kind === 'STAFF') {
      const staff = await this.staffRepository.findById(id);
      if (!staff || !staff.isActive) return null;
      return {
        kind: 'STAFF',
        id: staff.id,
        role: 'STAFF',
        displayName: staff.displayName,
        branch: staff.branch ? { id: staff.branch.id, name: staff.branch.name } : null,
      };
    }
    const admin = await this.adminsRepository.findById(id);
    // Only genuine administrator rows (see staff-roles.ts) may act as ADMIN in the staff panel.
    if (!admin || !admin.isActive || !isAdminRole(admin.role)) return null;
    return { kind: 'ADMIN', id: admin.id, role: 'ADMIN', displayName: admin.email, branch: null };
  }

  private async tryAuthenticate(identifier: string, password: string): Promise<StaffActor | null> {
    const staff = await this.staffRepository.findByUsername(identifier);
    if (staff) {
      const ok = await bcrypt.compare(password, staff.passwordHash);
      if (!ok || !staff.isActive) return null;
      return this.resolveActor('STAFF', staff.id);
    }
    if (identifier.includes('@')) {
      const admin = await this.adminsRepository.findByEmail(identifier);
      if (admin) {
        const ok = await bcrypt.compare(password, admin.passwordHash);
        if (!ok || !admin.isActive || !isAdminRole(admin.role)) return null;
        return this.resolveActor('ADMIN', admin.id);
      }
    }
    await bcrypt.compare(password, DUMMY_HASH);
    return null;
  }

  private assertNotThrottled(identifier: string): void {
    const entry = this.failures.get(identifier);
    if (entry && entry.lockedUntil > Date.now()) throw new StaffLoginThrottledError();
  }

  private recordFailure(identifier: string): void {
    const entry = this.failures.get(identifier) ?? { count: 0, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) {
      entry.lockedUntil = Date.now() + LOCK_MS;
      entry.count = 0;
    }
    this.failures.set(identifier, entry);
  }
}
