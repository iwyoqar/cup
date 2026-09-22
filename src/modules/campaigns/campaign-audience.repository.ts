import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class CampaignAudienceRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Self-contained profile lookup — same "each repository owns its own queries" pattern
  // SegmentsRepository.findCustomerProfilesByIds already uses, rather than CampaignsModule
  // depending on CustomersModule/AdminCustomersModule for this one small read.
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
