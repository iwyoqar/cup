import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { generateLoyaltyCode, isLoyaltyCodeCollision, LOYALTY_CODE_MAX_ATTEMPTS } from './loyalty-code';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.customer.findUnique({ where: { id } });
  }

  // Phase 11: new customers get their public identity code at creation. A (vanishingly unlikely)
  // collision on the unique index is retried with a fresh random code, never surfaced as a failure.
  async create(data: { displayName?: string; phone?: string; posterClientId?: string }) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.customer.create({ data: { ...data, loyaltyCode: generateLoyaltyCode() } });
      } catch (err) {
        if (isLoyaltyCodeCollision(err) && attempt < LOYALTY_CODE_MAX_ATTEMPTS) continue;
        throw err;
      }
    }
  }

  updatePhone(customerId: string, phone: string) {
    return this.prisma.customer.update({ where: { id: customerId }, data: { phone } });
  }

  // --- Phase 11: identity code ------------------------------------------------------------------

  // Phase 21 (POS widget): the explicit Poster mapping, read-only. posterClientId is UNIQUE, so at most one customer.
  findByPosterClientId(posterClientId: string) {
    return this.prisma.customer.findUnique({ where: { posterClientId }, select: { id: true, displayName: true, phone: true, loyaltyCode: true, posterClientId: true } });
  }

  findByLoyaltyCode(loyaltyCode: string) {
    return this.prisma.customer.findUnique({ where: { loyaltyCode }, include: { telegramAccount: true } });
  }

  findIdsWithoutLoyaltyCode() {
    return this.prisma.customer.findMany({ where: { loyaltyCode: null }, select: { id: true } });
  }

  // Only ever fills an EMPTY code (where loyaltyCode is null), so two concurrent callers can never
  // overwrite each other's freshly issued code — the loser simply updates zero rows.
  async setLoyaltyCodeIfMissing(customerId: string, loyaltyCode: string): Promise<boolean> {
    const result = await this.prisma.customer.updateMany({ where: { id: customerId, loyaltyCode: null }, data: { loyaltyCode } });
    return result.count === 1;
  }

  // Explicit admin regeneration: replaces the current code (the old one stops resolving at once).
  setLoyaltyCode(customerId: string, loyaltyCode: string) {
    return this.prisma.customer.update({ where: { id: customerId }, data: { loyaltyCode } });
  }

  // --- Phase 11: staff search + Poster mapping --------------------------------------------------

  // Minimal projection only. Bounded (take) and never a full customer dump.
  searchForStaff(where: { phoneVariants?: string[]; nameContains?: string }, take: number) {
    const or: object[] = [];
    if (where.phoneVariants?.length) or.push({ phone: { in: where.phoneVariants } });
    if (where.nameContains) {
      or.push({ displayName: { contains: where.nameContains } });
      or.push({ telegramAccount: { is: { username: { contains: where.nameContains } } } });
    }
    return this.prisma.customer.findMany({
      where: { OR: or },
      select: { id: true, displayName: true, phone: true, loyaltyCode: true, telegramAccount: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  // Explicit, non-overwriting Poster mapping: only fills an EMPTY posterClientId. The unique index on
  // posterClientId means one Poster client can belong to at most one CUP customer (a violation is thrown
  // to the caller as P2002).
  async setPosterClientIfMissing(customerId: string, posterClientId: string): Promise<boolean> {
    const result = await this.prisma.customer.updateMany({ where: { id: customerId, posterClientId: null }, data: { posterClientId } });
    return result.count === 1;
  }

  findLoyaltyCodeById(customerId: string) {
    return this.prisma.customer.findUnique({ where: { id: customerId }, select: { loyaltyCode: true } });
  }
}
