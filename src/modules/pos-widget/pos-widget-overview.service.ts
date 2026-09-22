import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { maskPhone } from '../../common/util/mask-phone';
import { CatalogRepository } from '../catalog/catalog.repository';
import { CustomerMetricsService } from '../customer-metrics/customer-metrics.service';
import { CustomersRepository } from '../customers/customers.repository';
import { normalizeLoyaltyCode } from '../customers/loyalty-code';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { LoyaltySettingsService } from '../loyalty/loyalty-settings.service';
import { Loyalty2ProfileService } from '../loyalty2/loyalty2-profile.service';
import { PosterImportedActivityService } from '../poster-import/poster-imported-activity.service';
import { PromotionsService } from '../promotions/promotions.service';
import { RewardProgramsService } from '../rewards/reward-programs.service';
import { phoneVariants } from '../staff/staff-customers.service';

export type OverviewIdentifier = { kind: 'posterClientId'; value: string } | { kind: 'code'; value: string } | { kind: 'phone'; value: string };

// The seam for Phase 22: the current order can later refine the promotion view WITHOUT redesigning the endpoint. It is accepted here and deliberately unused —
// Phase 21 shows what the customer qualifies for today, computed by the existing eligibility logic, never from the order contents.
export interface OverviewContext {
  orderTotalMinor?: number;
}

export type OverviewState = 'FOUND' | 'NOT_FOUND' | 'NOT_LINKED' | 'AMBIGUOUS';

interface ResolvedCustomer {
  id: string;
  displayName: string | null;
  phone: string | null;
  loyaltyCode: string | null;
  linkedToPoster: boolean;
}

const PRODUCTS_PER_PROGRAM = 12;

// Phase 21 — the compact, READ-ONLY overview a barista sees inside Poster POS. A composition layer only: every figure comes from the canonical read model that
// already owns it (LoyaltyService / Loyalty 2.0 profile / RewardProgramsService / PromotionsService / CustomerMetricsService / the imported-POS activity). Nothing is
// recalculated, nothing is written (not even a lazily created loyalty account), and no Poster or Telegram call is made.
//
// Privacy: no customer id, no Telegram id, no Poster client id, no full phone (masked), no promotion / program ids, no growth / CRM / referral data, no raw Poster payloads.
@Injectable()
export class PosWidgetOverviewService {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly loyalty: LoyaltyService,
    private readonly loyaltySettings: LoyaltySettingsService,
    private readonly loyalty2: Loyalty2ProfileService,
    private readonly rewards: RewardProgramsService,
    private readonly promotions: PromotionsService,
    private readonly metrics: CustomerMetricsService,
    private readonly posActivity: PosterImportedActivityService,
    private readonly catalog: CatalogRepository,
    private readonly config: ConfigService,
  ) {}

  // Resolves ONE customer, exactly: by the Poster client id the POS reports, by the public CUP code, or by an exact phone. No fuzzy matching, no name search.
  async resolve(id: OverviewIdentifier): Promise<{ kind: 'FOUND'; customer: ResolvedCustomer } | { kind: 'NOT_FOUND' | 'NOT_LINKED' | 'AMBIGUOUS' }> {
    if (id.kind === 'posterClientId') {
      const c = await this.customers.findByPosterClientId(id.value);
      // A Poster customer that CUP has no explicit mapping for is NOT guessed from name / phone: it is reported as not linked.
      return c ? { kind: 'FOUND', customer: { id: c.id, displayName: c.displayName, phone: c.phone, loyaltyCode: c.loyaltyCode, linkedToPoster: true } } : { kind: 'NOT_LINKED' };
    }
    if (id.kind === 'code') {
      const code = id.value.length <= 64 ? normalizeLoyaltyCode(id.value) : null;
      const c = code ? await this.customers.findByLoyaltyCode(code) : null;
      return c ? { kind: 'FOUND', customer: { id: c.id, displayName: c.displayName, phone: c.phone, loyaltyCode: c.loyaltyCode, linkedToPoster: !!c.posterClientId } } : { kind: 'NOT_FOUND' };
    }
    const digits = id.value.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) return { kind: 'NOT_FOUND' };
    const rows = await this.customers.searchForStaff({ phoneVariants: phoneVariants(digits) }, 2);
    if (rows.length === 0) return { kind: 'NOT_FOUND' };
    // Phone numbers are not unique in CUP: two customers on one number is never resolved by guessing — the barista is asked for the CUP code instead.
    if (rows.length > 1) return { kind: 'AMBIGUOUS' };
    const r = rows[0];
    const linked = await this.customers.findById(r.id);
    return { kind: 'FOUND', customer: { id: r.id, displayName: r.displayName, phone: r.phone, loyaltyCode: r.loyaltyCode, linkedToPoster: !!linked?.posterClientId } };
  }

  async build(customer: ResolvedCustomer, _context: OverviewContext = {}) {
    void _context; // reserved for Phase 22 (order-aware promotions)
    const customerId = customer.id;
    // Independent reads issued together; no dependent chain and no per-row loops.
    const [account, legacy, level2, programs, promotions, cup, pos] = await Promise.all([
      this.loyalty.getAccountSnapshot(customerId), // read-only: never creates an account or a welcome bonus
      this.loyaltySettings.get(),
      this.loyalty2.getProfile(customerId), // read-only; { enabled: false } while Loyalty 2.0 is off
      this.rewards.listForCustomer(customerId), // canonical reward progress (CUP + imported POS)
      this.promotions.listForCustomer(customerId), // canonical eligibility — only what the customer really qualifies for
      this.metrics.getSummaryForCustomer(customerId),
      this.posActivity.getForCustomer(customerId),
    ]);
    const products = await this.catalog.findActiveProductNamesByCategoryIds([...new Set(programs.map((p) => p.qualifyingCategoryId))]);

    const lastCup = cup.metrics.lastOrderAt;
    const lastVisit = lastCup && pos.lastAt ? (lastCup > pos.lastAt ? lastCup : pos.lastAt) : (lastCup ?? pos.lastAt);
    const availableTotal = programs.reduce((n, p) => n + p.availableRewards, 0);

    return {
      customer: { displayName: customer.displayName, phoneMasked: maskPhone(customer.phone), code: customer.loyaltyCode },
      linkedToPoster: customer.linkedToPoster,
      loyalty: {
        legacyProgramEnabled: legacy.enabled,
        points: legacy.enabled && account ? account.balance : null,
        program2: level2.enabled
          ? {
              enabled: true as const,
              level: level2.level ? { name: level2.level.name, icon: level2.level.icon, color: level2.level.color } : null,
              nextLevel: level2.nextLevel ? { name: level2.nextLevel.name, spendToNext: level2.nextLevel.spendToNext } : null,
              xp: { total: level2.xp.lifetimeXP, toNextLevel: level2.xp.xpToNextLevel },
              streak: { enabled: level2.streak.enabled, current: level2.streak.current },
              cashbackMinor: level2.cashback.enabled ? level2.cashback.balance : null,
            }
          : { enabled: false as const },
      },
      rewards: {
        availableTotal,
        // Phase 22: redemption is a SEPARATE operator interlock from the widget itself (POS_WIDGET_ENABLED) — the overview can stay readable while
        // redemption stays off. `programId` is not customer data (no personal information, on par with the product/category ids this project's other
        // customer-facing responses already expose when a client needs to act on them — see reward-program.types.ts's CustomerRewardProgramView comment);
        // it is what a redemption request must reference. `posterProductId` is the merchant's own catalog id, already visible to the cashier on the
        // register — never a CUP internal id.
        redemption: { enabled: this.config.env.POS_REWARD_REDEMPTION_ENABLED },
        programs: programs.map((p) => ({
          programId: p.programId,
          name: p.program.name,
          threshold: p.threshold,
          progress: p.qualifyingCount,
          remaining: Math.max(0, p.threshold - p.qualifyingCount),
          available: p.availableRewards,
          eligibleProducts: products
            .filter((x) => x.categoryId === p.qualifyingCategoryId)
            .slice(0, PRODUCTS_PER_PROGRAM)
            .map((x) => ({ posterProductId: x.posterProductId, name: x.name })),
        })),
      },
      promotions: {
        // Phase 23: same shape as `rewards` above — a separate operator interlock (POS_PROMOTION_REDEMPTION_ENABLED) from the widget itself, so the
        // overview stays readable while redemption stays off. `promotionId` is not customer data (same reasoning as `programId` on rewards) — it is
        // what a redemption request must reference. The benefit is otherwise re-mapped so the product's internal id (present in the shared promotion
        // view) never reaches the widget.
        redemption: { enabled: this.config.env.POS_PROMOTION_REDEMPTION_ENABLED },
        items: promotions.map((p) => ({
          promotionId: p.id,
          name: p.name,
          description: p.description,
          benefit: { type: p.benefit.type, value: p.benefit.value, product: p.benefit.product ? { name: p.benefit.product.name } : null, quantity: p.benefit.quantity },
          endsAt: p.endsAt,
          remainingUses: p.remainingUses,
        })),
      },
      activity: { visits: cup.metrics.orderCount + pos.count, lastVisitAt: lastVisit ? lastVisit.toISOString() : null },
    };
  }
}
