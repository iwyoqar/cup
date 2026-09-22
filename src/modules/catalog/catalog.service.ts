import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { PosterService } from '../poster/poster.service';
import { PosterCategory, PosterProduct } from '../poster/poster.types';
import { PosterMoneyError, posterPriceToCupUzs } from '../poster/poster-money';
import { CatalogRepository } from './catalog.repository';

export interface CatalogSyncResult {
  categoriesSynced: number;
  categoriesSkipped: { posterCategoryId: string; reason: string }[];
  productsSynced: number;
  productsSkipped: { posterProductId: string; reason: string }[];
}

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly poster: PosterService,
    private readonly catalogRepository: CatalogRepository,
    private readonly config: ConfigService,
  ) {}

  async sync(): Promise<CatalogSyncResult> {
    const [posterCategories, posterProducts] = await Promise.all([
      this.poster.getCategories(),
      this.poster.getProducts(),
    ]);

    const categoriesSkipped: { posterCategoryId: string; reason: string }[] = [];
    let categoriesSynced = 0;

    for (const [index, category] of posterCategories.entries()) {
      try {
        this.validateCategoryShape(category);
        await this.catalogRepository.upsertCategory({
          posterCategoryId: category.category_id,
          name: category.category_name,
          sortOrder: index,
        });
        categoriesSynced += 1;
      } catch (err) {
        // Symmetric with product handling below: one malformed/unexpected category must not
        // abort the whole sync (categories AND products) — it is skipped and reported instead.
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.error(`Skipping category ${category.category_id}: ${reason}`);
        categoriesSkipped.push({ posterCategoryId: category.category_id, reason });
      }
    }

    if (posterCategories.length > 0) {
      await this.catalogRepository.deactivateCategoriesNotIn(posterCategories.map((c) => c.category_id));
    } else {
      // An empty list from Poster is indistinguishable from "menu genuinely has zero
      // categories" and "something went wrong upstream" — treated as suspicious, never as
      // authorization to wipe out the entire local catalog.
      this.logger.warn('Poster returned an empty category list — skipping category deactivation as a precaution.');
    }

    const productsSkipped: { posterProductId: string; reason: string }[] = [];
    let productsSynced = 0;

    for (const product of posterProducts) {
      try {
        const priceMinor = this.extractPriceMinor(product);
        const category = await this.catalogRepository.findCategoryByPosterId(product.menu_category_id);
        if (!category) {
          productsSkipped.push({
            posterProductId: product.product_id,
            reason: `Unknown menu_category_id "${product.menu_category_id}" — sync categories before products.`,
          });
          continue;
        }
        await this.catalogRepository.upsertProduct({
          posterProductId: product.product_id,
          categoryId: category.id,
          name: product.product_name,
          priceMinor,
        });
        productsSynced += 1;
      } catch (err) {
        // Per docs/PHASE-0-PLAN.md: an unverified/unexpected Poster shape for a single
        // product must not silently corrupt data or abort the whole sync — it is skipped
        // and reported loudly instead.
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.error(`Skipping product ${product.product_id}: ${reason}`);
        productsSkipped.push({ posterProductId: product.product_id, reason });
      }
    }

    if (posterProducts.length > 0) {
      await this.catalogRepository.deactivateProductsNotIn(posterProducts.map((p) => p.product_id));
    } else {
      this.logger.warn('Poster returned an empty product list — skipping product deactivation as a precaution.');
    }

    return { categoriesSynced, categoriesSkipped, productsSynced, productsSkipped };
  }

  listCategories() {
    return this.catalogRepository.findAllActiveCategories();
  }

  listProducts() {
    return this.catalogRepository.findAllActiveProducts();
  }

  // The price field's key structure in menu.getProducts is UNVERIFIED (see poster.types.ts).
  // This makes one explicit, documented assumption — that it is keyed by spot id, matching
  // the verified spot_id=1 test value — and throws rather than silently defaulting if that
  // assumption doesn't hold, so a shape mismatch is surfaced instead of guessed past.
  private extractPriceMinor(product: PosterProduct): number {
    const spotKey = String(this.config.env.POSTER_DEFAULT_SPOT_ID);
    const raw = product.price?.[spotKey];
    if (raw === undefined) {
      throw new Error(
        `Product ${product.product_id} has no price for spot "${spotKey}" — ` +
          `unverified price-record shape, refusing to guess (raw: ${JSON.stringify(product.price)})`,
      );
    }
    // Phase 10.1: the ONLY place Poster's price enters CUP, and it goes through the Poster money
    // adapter — this file no longer interprets Poster's monetary unit itself. What comes back is
    // CUP's canonical whole-UZS integer (a fractional/negative/empty Poster value is rejected there
    // and surfaced per product, never truncated into the Int column).
    try {
      return posterPriceToCupUzs(raw);
    } catch (err) {
      if (err instanceof PosterMoneyError) {
        throw new Error(`Product ${product.product_id} has an invalid price (${err.message}) — raw: ${raw}`);
      }
      throw err;
    }
  }

  private validateCategoryShape(category: PosterCategory): void {
    if (!category.category_id || typeof category.category_name !== 'string' || category.category_name.length === 0) {
      throw new Error(`Category has an unexpected shape (raw: ${JSON.stringify(category)})`);
    }
  }
}
