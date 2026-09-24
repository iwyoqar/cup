import { Injectable, Logger } from '@nestjs/common';
import { PosterMoneyError, posterPriceToCupUzs } from '../poster/poster-money';
import { PosterService } from '../poster/poster.service';
import { FinanceCogsRepository, ProductCostUpdate } from './finance-cogs.repository';

const CONCURRENCY = 5; // menu.getProduct has no bulk form; bounded parallelism keeps one sync tick from hammering Poster or running too long
const DISH_TYPE = '2'; // documented: menu.getProduct's `type` — "2" = a configured Dish (has a real recipe)

export interface CogsSyncResult {
  scanned: number;
  withRecipe: number;
  withoutRecipe: number;
  failed: { posterProductId: string; reason: string }[];
}

// Finance-1 — COGS is read LIVE from Poster's own recipe/"Dish" data (menu.getProduct), never
// invented by CUP. A product Poster has no recipe configured for keeps hasRecipe=false and a null
// cost forever, until the owner configures one in Poster's own UI — the finance dashboard shows
// "Data incomplete" for it (see finance-pnl.service.ts), it is never estimated or guessed.
@Injectable()
export class FinanceCogsSyncService {
  private readonly logger = new Logger(FinanceCogsSyncService.name);

  constructor(
    private readonly poster: PosterService,
    private readonly repository: FinanceCogsRepository,
  ) {}

  async sync(): Promise<CogsSyncResult> {
    const products = await this.repository.findActiveProducts();
    const failed: CogsSyncResult['failed'] = [];
    const updates: ProductCostUpdate[] = [];

    for (let i = 0; i < products.length; i += CONCURRENCY) {
      const batch = products.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (p) => {
          try {
            const detail = await this.poster.getProductDetail(p.posterProductId);
            if (!detail) return { id: p.id, hasRecipe: false, theoreticalCostMinor: null } satisfies ProductCostUpdate;
            const hasRecipe = detail.type === DISH_TYPE && Array.isArray(detail.ingredients) && detail.ingredients.length > 0;
            if (!hasRecipe) return { id: p.id, hasRecipe: false, theoreticalCostMinor: null } satisfies ProductCostUpdate;
            if (detail.cost === undefined) {
              failed.push({ posterProductId: p.posterProductId, reason: 'Dish with ingredients but no "cost" field — unexpected shape, refusing to guess.' });
              return null;
            }
            const theoreticalCostMinor = posterPriceToCupUzs(detail.cost);
            return { id: p.id, hasRecipe: true, theoreticalCostMinor } satisfies ProductCostUpdate;
          } catch (err) {
            const reason = err instanceof PosterMoneyError ? err.message : err instanceof Error ? err.message : String(err);
            failed.push({ posterProductId: p.posterProductId, reason });
            return null;
          }
        }),
      );
      for (const r of results) if (r) updates.push(r);
    }

    if (updates.length > 0) await this.repository.applyCostUpdates(updates);
    if (failed.length > 0) this.logger.warn(`COGS sync: ${failed.length} product(s) could not be read: ${failed.map((f) => `${f.posterProductId} (${f.reason})`).join('; ')}`);

    return {
      scanned: products.length,
      withRecipe: updates.filter((u) => u.hasRecipe).length,
      withoutRecipe: updates.filter((u) => !u.hasRecipe).length,
      failed,
    };
  }
}
