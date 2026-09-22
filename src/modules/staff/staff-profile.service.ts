import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { maskPhone } from '../../common/util/mask-phone';
import { BranchRepository } from '../branches/branch.repository';
import { CustomerActivityService } from '../admin-customers/customer-activity.service';
import { CustomersRepository } from '../customers/customers.repository';
import { normalizeLoyaltyCode } from '../customers/loyalty-code';
import { GrowthIntelligenceService } from '../growth-intelligence/growth-intelligence.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { LoyaltySettingsService } from '../loyalty/loyalty-settings.service';
import { Loyalty2ProfileService } from '../loyalty2/loyalty2-profile.service';
import { PromotionsService } from '../promotions/promotions.service';
import { ReferralsService } from '../referrals/referrals.service';
import { RewardProgramsService } from '../rewards/reward-programs.service';
import { StaffActor } from './staff-auth.service';
import { StaffRepository } from './staff.repository';

// Bounded by construction: one page of activity, a handful of redemptions, every other block is a fixed-size read model.
export const PROFILE_ACTIVITY_LIMIT = 10;
export const MAX_ACTIVITY_LIMIT = 20;
const REDEMPTION_SUMMARY_LIMIT = 3;
// A page refresh must not write an audit row each time: the same staff member viewing the same customer again within this window is one event.
const VIEW_AUDIT_DEDUPE_MS = 60_000;
export const RECENT_CUSTOMERS_LIMIT = 10;

export interface ProfileScopeRequest {
  scope?: 'branch' | 'all';
  branchId?: string;
}

export interface ResolvedScope {
  kind: 'BRANCH' | 'ALL';
  branchId: string | null;
  branchName: string | null;
}

// Phase 16 — the Staff Customer Profile: ONE composed, bounded, read-only response for a customer identified by their PUBLIC loyalty code. It is a
// composition layer only: every figure comes from the canonical read model that already owns it (LoyaltyService / Loyalty 2.0 profile / RewardProgramsService
// / PromotionsService eligibility / ReferralsService / GrowthIntelligenceService / the Customer 360 activity feed). Nothing is recalculated here and nothing
// is written except the (de-duplicated) audit row. No Poster or Telegram call is made.
//
// Privacy: no customer id, no Telegram id, no Poster client id, no full phone (masked), no promotion / program / referral ids, no admin data (segments,
// campaigns, CRM recommendations).
@Injectable()
export class StaffProfileService {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly loyalty: LoyaltyService,
    private readonly loyaltySettings: LoyaltySettingsService,
    private readonly loyalty2: Loyalty2ProfileService,
    private readonly rewards: RewardProgramsService,
    private readonly promotions: PromotionsService,
    private readonly referrals: ReferralsService,
    private readonly growth: GrowthIntelligenceService,
    private readonly activity: CustomerActivityService,
    private readonly branches: BranchRepository,
    private readonly staffRepository: StaffRepository,
  ) {}

  // Scope rules (explicit, never inferred):
  //   * `branchId` given  -> that branch. Allowed for an ADMIN actor and for staff with no branch; a staff member assigned to a branch may only ask for
  //                          THEIR OWN branch (anything else is 403). An unknown / inactive branch is 400.
  //   * `scope=all`       -> every branch (customer-level view; allowed — the customer's identity and loyalty are global).
  //   * otherwise         -> the staff member's own branch when assigned, else every branch.
  async resolveScope(actor: StaffActor, request: ProfileScopeRequest): Promise<ResolvedScope> {
    if (request.branchId) {
      if (actor.role === 'STAFF' && actor.branch && actor.branch.id !== request.branchId) throw new ForbiddenException('You can only view your own branch.');
      const branch = await this.branches.findById(request.branchId);
      if (!branch || !branch.isActive) throw new BadRequestException('Unknown branch.');
      return { kind: 'BRANCH', branchId: branch.id, branchName: branch.name };
    }
    if (request.scope === 'all' || !actor.branch) return { kind: 'ALL', branchId: null, branchName: null };
    return { kind: 'BRANCH', branchId: actor.branch.id, branchName: actor.branch.name };
  }

  async getProfile(actor: StaffActor, rawCode: string, request: ProfileScopeRequest = {}) {
    const customer = await this.requireCustomer(actor, rawCode);
    const scope = await this.resolveScope(actor, request);
    const customerId = customer.id;

    // Independent reads issued together; no dependent chain and no per-row loops (each block is itself a bounded read model).
    const [account, legacySettings, level2, programs, redemptions, promotions, referral, growthAll, growthBranch, feed] = await Promise.all([
      this.loyalty.getAccountSnapshot(customerId), // read-only: never creates an account or a welcome bonus
      this.loyaltySettings.get(),
      this.loyalty2.getProfile(customerId), // read-only; { enabled: false } while Loyalty 2.0 is off
      this.rewards.listForCustomer(customerId), // canonical RewardProgressService figures (CUP + imported POS)
      this.rewards.redemptionSummaryForCustomer(customerId, REDEMPTION_SUMMARY_LIMIT),
      this.promotions.listForCustomer(customerId), // canonical eligibility — only what the customer really qualifies for
      this.referrals.getStaffView(customerId),
      this.growth.getCustomerBlock(customerId), // all branches (the customer's true lifecycle)
      scope.branchId ? this.growth.getCustomerBlock(customerId, new Date(), scope.branchId) : Promise.resolve(null),
      this.activity.getFeed(customerId, { limit: PROFILE_ACTIVITY_LIMIT, filter: 'purchases', branchId: scope.branchId }),
    ]);

    await this.auditView(actor, customerId);

    const birthday = customer.birthDate ? { month: customer.birthDate.getUTCMonth() + 1, day: customer.birthDate.getUTCDate() } : null; // day + month only, never the year
    const availableTotal = programs.reduce((n, p) => n + p.availableRewards, 0);
    const growthView = (b: NonNullable<typeof growthBranch>) => ({
      lifecycleState: b.lifecycleState,
      rfm: b.rfm,
      recencyDays: b.recencyDays,
      frequency: b.frequency,
      monetary: b.monetary,
      lookbackDays: b.lookbackDays,
      lifetimePurchases: b.lifetimePurchases,
      lifetimeRevenue: b.lifetimeRevenue,
      firstPurchaseAt: b.firstPurchaseAt,
      lastPurchaseAt: b.lastPurchaseAt,
    });

    return {
      scope: { kind: scope.kind, branch: scope.branchName ? { name: scope.branchName } : null },
      identity: {
        displayName: customer.displayName,
        publicCode: customer.loyaltyCode as string,
        phoneMasked: maskPhone(customer.phone),
        telegramUsername: customer.telegramAccount?.username ?? null,
        poster: { state: customer.posterClientId ? ('LINKED' as const) : ('NOT_LINKED' as const) },
        customerSince: customer.createdAt.toISOString(),
        firstPurchaseAt: growthAll.firstPurchaseAt,
        birthday,
      },
      loyalty: {
        legacyProgramEnabled: legacySettings.enabled,
        account: account ? { balance: account.balance, lifetimeEarned: account.lifetimeEarned, lifetimeSpent: account.lifetimeSpent } : null,
        program2: level2.enabled
          ? {
              enabled: true as const,
              level: level2.level ? { name: level2.level.name, icon: level2.level.icon, color: level2.level.color } : null,
              nextLevel: level2.nextLevel ? { name: level2.nextLevel.name, spendToNext: level2.nextLevel.spendToNext } : null,
              xp: level2.xp,
              streak: level2.streak,
              cashback: level2.cashback,
              birthday: { eligible: level2.birthday.eligible },
            }
          : { enabled: false as const },
      },
      rewards: {
        programs: programs.map((p) => ({
          programName: p.program.name,
          threshold: p.threshold,
          qualifyingCount: p.qualifyingCount,
          remainingToNext: Math.max(0, p.threshold - p.qualifyingCount),
          availableRewards: p.availableRewards,
        })),
        availableTotal,
        redemptions,
      },
      // The benefit is re-mapped so the product's internal id (present in the shared promotion view) never reaches Staff.
      promotions: promotions.map((p) => ({
        name: p.name,
        description: p.description,
        benefit: { type: p.benefit.type, value: p.benefit.value, product: p.benefit.product ? { name: p.benefit.product.name } : null, quantity: p.benefit.quantity },
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        remainingUses: p.remainingUses,
      })),
      referral,
      growth: {
        all: {
          ...growthView(growthAll),
          signals: growthAll.signals,
          // The CRM recommendation (which Segment / automation trigger fits) is an admin concern — staff see the descriptive reason only.
          opportunities: growthAll.opportunities.map((o) => ({ type: o.type, priority: o.priority, reason: o.reason })),
        },
        branch: growthBranch && scope.branchName ? { branchName: scope.branchName, ...growthView(growthBranch) } : null,
      },
      activity: { scope: scope.kind, ...feed },
    };
  }

  // Paginated older activity for the same customer and scope (opaque cursor, at most MAX_ACTIVITY_LIMIT rows per page).
  async getActivity(actor: StaffActor, rawCode: string, request: ProfileScopeRequest & { cursor?: string; limit?: number }) {
    const customer = await this.requireCustomer(actor, rawCode, false);
    const scope = await this.resolveScope(actor, request);
    const limit = Math.min(MAX_ACTIVITY_LIMIT, Math.max(1, request.limit ?? PROFILE_ACTIVITY_LIMIT));
    const feed = await this.activity.getFeed(customer.id, { limit, filter: 'purchases', cursor: request.cursor, branchId: scope.branchId });
    return { scope: scope.kind, ...feed };
  }

  // The customers THIS staff member looked at most recently (from their own audit trail) — a "recent" list that survives a page reload or a tablet change.
  async getRecent(actor: StaffActor) {
    const rows = await this.staffRepository.recentViewedCustomerIds(actor.id, 100);
    const distinct = [...new Map(rows.map((r) => [r.customerId, r.createdAt])).entries()].slice(0, RECENT_CUSTOMERS_LIMIT);
    if (distinct.length === 0) return [];
    const ids = distinct.map(([id]) => id);
    const [people, indicators] = await Promise.all([this.staffRepository.customersByIds(ids), this.growth.getListIndicators(ids)]);
    const byId = new Map(people.map((p) => [p.id, p]));
    return distinct
      .map(([id, at]) => {
        const p = byId.get(id);
        if (!p || !p.loyaltyCode) return null;
        const g = indicators.get(id);
        return { displayName: p.displayName, publicCode: p.loyaltyCode, phoneMasked: maskPhone(p.phone), viewedAt: at.toISOString(), lifecycleState: g?.lifecycleState ?? null, lastPurchaseAt: g?.lastPurchaseAt ?? null };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  // A malformed or unknown code is one indistinguishable 404 (no oracle for probing which codes exist).
  private async requireCustomer(actor: StaffActor, rawCode: string, audit = true) {
    const code = rawCode.length <= 64 ? normalizeLoyaltyCode(rawCode) : null;
    const customer = code ? await this.customers.findByLoyaltyCode(code) : null;
    if (!customer) {
      if (audit) await this.staffRepository.recordEvent({ actorType: actor.kind, actorId: actor.id, action: 'PROFILE_VIEW', result: 'NOT_FOUND', customerId: null, branchId: actor.branch?.id ?? null });
      throw new NotFoundException('Customer not found.');
    }
    return customer;
  }

  private async auditView(actor: StaffActor, customerId: string) {
    const since = new Date(Date.now() - VIEW_AUDIT_DEDUPE_MS);
    if (await this.staffRepository.hasRecentEvent(actor.id, customerId, 'PROFILE_VIEW', since)) return;
    await this.staffRepository.recordEvent({ actorType: actor.kind, actorId: actor.id, action: 'PROFILE_VIEW', result: 'FOUND', customerId, branchId: actor.branch?.id ?? null });
  }
}

