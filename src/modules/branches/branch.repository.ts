import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface UpsertBranchData {
  posterSpotId: number;
  name: string;
  address: string | null;
}

@Injectable()
export class BranchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertBranch(data: UpsertBranchData) {
    return this.prisma.branch.upsert({
      where: { posterSpotId: data.posterSpotId },
      create: { ...data, isActive: true, syncedAt: new Date() },
      update: { name: data.name, address: data.address, isActive: true, syncedAt: new Date() },
    });
  }

  async deactivateBranchesNotIn(posterSpotIds: number[]) {
    await this.prisma.branch.updateMany({
      where: { posterSpotId: { notIn: posterSpotIds } },
      data: { isActive: false },
    });
  }

  findAllActive() {
    return this.prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  findByPosterSpotId(posterSpotId: number) {
    return this.prisma.branch.findUnique({ where: { posterSpotId } });
  }

  findById(id: string) {
    return this.prisma.branch.findUnique({ where: { id } });
  }

  // Phase 5: segment condition validation for the favoriteBranch field — confirms the admin
  // typed/selected a real branch name before the segment is saved (spec: "Validate... branch
  // existence where applicable"). Deliberately not restricted to isActive-only: a segment may
  // legitimately reference a branch that's since been deactivated but still has historical
  // orders attached to it.
  findByName(name: string) {
    return this.prisma.branch.findFirst({ where: { name } });
  }
}
