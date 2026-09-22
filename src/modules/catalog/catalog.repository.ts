import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface UpsertCategoryData {
  posterCategoryId: string;
  name: string;
  sortOrder: number;
}

export interface UpsertProductData {
  posterProductId: string;
  categoryId: string; // local CUP category id, already resolved
  name: string;
  priceMinor: number;
}

@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertCategory(data: UpsertCategoryData) {
    return this.prisma.category.upsert({
      where: { posterCategoryId: data.posterCategoryId },
      create: { ...data, isActive: true, syncedAt: new Date() },
      update: { name: data.name, sortOrder: data.sortOrder, isActive: true, syncedAt: new Date() },
    });
  }

  async upsertProduct(data: UpsertProductData) {
    return this.prisma.product.upsert({
      where: { posterProductId: data.posterProductId },
      create: { ...data, isActive: true, syncedAt: new Date() },
      update: {
        name: data.name,
        categoryId: data.categoryId,
        priceMinor: data.priceMinor,
        isActive: true,
        syncedAt: new Date(),
      },
    });
  }

  async deactivateCategoriesNotIn(posterCategoryIds: string[]) {
    await this.prisma.category.updateMany({
      where: { posterCategoryId: { notIn: posterCategoryIds } },
      data: { isActive: false },
    });
  }

  async deactivateProductsNotIn(posterProductIds: string[]) {
    await this.prisma.product.updateMany({
      where: { posterProductId: { notIn: posterProductIds } },
      data: { isActive: false },
    });
  }

  findAllActiveCategories() {
    return this.prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  // Phase 21 (POS widget overview), widened in Phase 22 (POS_widget product SELECTION needs a real id, not just a name — posterProductId, since it is the
  // merchant's own catalog id, already visible to the cashier on the register itself; never a CUP internal id). Bounded by the menu size.
  findActiveProductNamesByCategoryIds(categoryIds: string[]) {
    if (categoryIds.length === 0) return Promise.resolve([] as { id: string; posterProductId: string; name: string; categoryId: string }[]);
    return this.prisma.product.findMany({ where: { isActive: true, categoryId: { in: categoryIds } }, select: { id: true, posterProductId: true, name: true, categoryId: true }, orderBy: { name: 'asc' } });
  }

  findAllActiveProducts() {
    return this.prisma.product.findMany({ where: { isActive: true } });
  }

  findProductById(id: string) {
    return this.prisma.product.findUnique({ where: { id } });
  }

  // Phase 22 (POS widget): resolves the widget's product SELECTION (sent back as posterProductId — see findActiveProductNamesByCategoryIds) to a CUP
  // product. The server independently re-verifies category/active state from this row; the widget's claim is never trusted (docs/PHASE-22-AUDIT.md §9).
  findProductByPosterProductId(posterProductId: string) {
    return this.prisma.product.findUnique({ where: { posterProductId } });
  }

  findCategoryByPosterId(posterCategoryId: string) {
    return this.prisma.category.findUnique({ where: { posterCategoryId } });
  }

  // Phase 8: RewardProgram's qualifying-category validation (reward-programs.service.ts) — same
  // "find by CUP id" pattern as findProductById, just for Category.
  findCategoryById(id: string) {
    return this.prisma.category.findUnique({ where: { id } });
  }
}
