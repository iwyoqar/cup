import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class StaffRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUsername(username: string) {
    return this.prisma.staffMember.findUnique({ where: { username }, include: { branch: true } });
  }

  findById(id: string) {
    return this.prisma.staffMember.findUnique({ where: { id }, include: { branch: true } });
  }

  list() {
    return this.prisma.staffMember.findMany({ orderBy: { createdAt: 'asc' }, include: { branch: true } });
  }

  create(data: { username: string; passwordHash: string; displayName: string; branchId: string | null }) {
    return this.prisma.staffMember.create({ data, include: { branch: true } });
  }

  update(id: string, data: { passwordHash?: string; displayName?: string; branchId?: string | null; isActive?: boolean }) {
    return this.prisma.staffMember.update({ where: { id }, data, include: { branch: true } });
  }

  recordEvent(data: { actorType: string; actorId: string; action: string; result: string; customerId?: string | null; branchId?: string | null }) {
    return this.prisma.staffScanEvent.create({ data });
  }

  // Phase 16: has this actor already logged this action for this customer since `since`? (lets a page refresh stay one audit event)
  async hasRecentEvent(actorId: string, customerId: string, action: string, since: Date): Promise<boolean> {
    return (await this.prisma.staffScanEvent.count({ where: { actorId, customerId, action, result: 'FOUND', createdAt: { gte: since } } })) > 0;
  }

  // Phase 16: this actor's newest successful lookups / profile views (bounded), newest first — the source of the "Recent" list. Uses the existing
  // (actorId, createdAt) index.
  recentViewedCustomerIds(actorId: string, take: number) {
    return this.prisma.staffScanEvent
      .findMany({ where: { actorId, action: { in: ['LOOKUP', 'PROFILE_VIEW'] }, result: 'FOUND', customerId: { not: null } }, orderBy: { createdAt: 'desc' }, take, select: { customerId: true, createdAt: true } })
      .then((rows) => rows.map((r) => ({ customerId: r.customerId as string, createdAt: r.createdAt })));
  }

  // Minimal projection for the Recent list (no Telegram / Poster data).
  customersByIds(ids: string[]) {
    return this.prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, phone: true, loyaltyCode: true } });
  }
}
