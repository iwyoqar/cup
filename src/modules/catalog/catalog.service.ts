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

// Owner decision (2026-09-23), not inferred from product names: of the products Poster files under
// no category ("Top screen" quick-access grid, menu_category_id "0"), these Poster product_ids are
// genuine coffee drinks and belong in the real "Кофе" category (posterCategoryId "1", verified live)
// so they qualify for the "5+1" reward program like every other coffee item. The remaining Top-screen
// products (water, pastries, milk/syrup add-ons) were explicitly excluded by the owner and stay under
// the "Top screen" fallback category — see catalog.service.ts's sync() fallback-category comment.
const TOP_SCREEN_COFFEE_PRODUCT_IDS: ReadonlySet<string> = new Set([
  '37', // Капучино 250 мл
  '38', // Капучино 350 мл
  '39', // Латте 250 мл
  '40', // Латте 350 мл
  '41', // Флэт Уайт
  '42', // Раф кофе
  '43', // Мокко
  '44', // Кортадо
  '45', // Айс Американо
  '46', // Айс Латте
  '47', // Колд Брю 350 мл
  '48', // Эспрессо Тоник
  '49', // Аффогато
  '50', // Пуровер V60 (гостевой сорт)
  '51', // Эспрессо (гостевой сорт)
  '54', // Доп. шот эспрессо
]);
const COFFEE_POSTER_CATEGORY_ID = '1';

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

    // Found live 2026-09-22/23: ~24 of 29 real products (both Cappuccino sizes, Latte, Flat White,
    // etc.) report menu_category_id "0" — Poster's own sentinel for "placed on the register's Top
    // screen quick-access grid, filed under no category tab" — and were silently skipped by the
    // product loop below (findCategoryByPosterId found nothing), so they never entered `Product` at
    // all: never importable from a POS receipt, never reward-eligible, never visible anywhere in CUP.
    // This is a real (if unusual) menu organization choice on Poster's side, not a data error, so the
    // fix is not to skip these products but to give menu_category_id "0" a real Category row too —
    // named from what Poster itself reports on the product (`category_name`, verified live to be the
    // literal string "Top screen" for every such product), never guessed. A real Poster category with
    // the same id would simply overwrite this in the loop above; in practice Poster never allocates "0"
    // to a real category (it is the products' own "no category" value), so no collision is expected.
    const knownCategoryIds = new Set(posterCategories.map((c) => c.category_id));
    const fallbackCategories = new Map<string, { posterCategoryId: string; name: string }>();
    for (const product of posterProducts) {
      if (!knownCategoryIds.has(product.menu_category_id) && !fallbackCategories.has(product.menu_category_id) && product.category_name) {
        fallbackCategories.set(product.menu_category_id, { posterCategoryId: product.menu_category_id, name: product.category_name });
      }
    }
    let fallbackSortOrder = posterCategories.length; // sorts after every real category tab
    for (const fallback of fallbackCategories.values()) {
      await this.catalogRepository.upsertCategory({ posterCategoryId: fallback.posterCategoryId, name: fallback.name, sortOrder: fallbackSortOrder });
      categoriesSynced += 1;
      fallbackSortOrder += 1;
    }

    if (posterCategories.length > 0) {
      await this.catalogRepository.deactivateCategoriesNotIn([...posterCategories.map((c) => c.category_id), ...fallbackCategories.keys()]);
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
        // Owner override (see TOP_SCREEN_COFFEE_PRODUCT_IDS): a coffee drink Poster itself files under
        // no category is resolved against the real "Кофе" category instead of the "Top screen" fallback.
        const targetCategoryId = TOP_SCREEN_COFFEE_PRODUCT_IDS.has(product.product_id) ? COFFEE_POSTER_CATEGORY_ID : product.menu_category_id;
        const category = await this.catalogRepository.findCategoryByPosterId(targetCategoryId);
        if (!category) {
          productsSkipped.push({
            posterProductId: product.product_id,
            reason: `Unknown menu_category_id "${targetCategoryId}" — sync categories before products.`,
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
