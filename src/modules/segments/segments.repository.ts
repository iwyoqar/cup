import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface PersistedCondition {
  field: string;
  operator: string;
  value: string;
}

export interface SaveSegmentData {
  name: string;
  description: string | null;
  logic: string;
  isActive: boolean;
  conditions: PersistedCondition[];
}

const SEGMENT_INCLUDE = { conditions: true } as const;

@Injectable()
export class SegmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(options: { cursor?: string; take: number }) {
    return this.prisma.segment.findMany({
      orderBy: { updatedAt: 'desc' },
      take: options.take,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: SEGMENT_INCLUDE,
    });
  }

  // Phase 11.4: every ACTIVE segment definition with its conditions, in one query (bounded by the number of segments).
  findActive() {
    return this.prisma.segment.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, include: SEGMENT_INCLUDE });
  }

  findById(id: string) {
    return this.prisma.segment.findUnique({ where: { id }, include: SEGMENT_INCLUDE });
  }

  create(data: SaveSegmentData & { createdBy: string | null }) {
    return this.prisma.segment.create({
      data: {
        name: data.name,
        description: data.description,
        logic: data.logic,
        isActive: data.isActive,
        createdBy: data.createdBy,
        updatedBy: data.createdBy,
        conditions: { create: data.conditions },
      },
      include: SEGMENT_INCLUDE,
    });
  }

  // Conditions are always read/written as a whole unit (a segment is never evaluated with only
  // some of its conditions) — an update that includes `conditions` replaces the full set via
  // delete-then-recreate rather than trying to diff individual rows, which would add real
  // complexity for no behavioral benefit here.
  update(id: string, data: Partial<SaveSegmentData> & { updatedBy: string | null }) {
    return this.prisma.segment.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.logic !== undefined ? { logic: data.logic } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        updatedBy: data.updatedBy,
        ...(data.conditions !== undefined ? { conditions: { deleteMany: {}, create: data.conditions } } : {}),
      },
      include: SEGMENT_INCLUDE,
    });
  }

  // onDelete: Cascade on SegmentCondition means this alone removes its conditions too.
  delete(id: string) {
    return this.prisma.segment.delete({ where: { id } });
  }

  // Self-contained customer-profile lookup for the matching-customers response — the same
  // "each repository owns its own Prisma queries" pattern AdminCustomersRepository already
  // uses, rather than SegmentsModule depending on CustomersModule/AdminCustomersModule for
  // this one small read.
  findCustomerProfilesByIds(customerIds: string[]) {
    return this.prisma.customer.findMany({
      where: { id: { in: customerIds } },
      include: { telegramAccount: { select: { username: true } } },
    });
  }
}
