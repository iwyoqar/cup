import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class PromotionAudienceRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Self-contained profile lookup — same "each repository owns its own queries" pattern as
  // campaign-audience.repository.ts / segments.repository.ts's findCustomerProfilesByIds.
  findCustomerProfilesByIds(customerIds: string[]) {
    if (customerIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, displayName: true, phone: true },
    });
  }
}
