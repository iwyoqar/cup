import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { OrderStatus } from '../../common/enums/order-status';
import { maskPhone } from '../../common/util/mask-phone';
import { CustomerMetricsService } from '../customer-metrics/customer-metrics.service';
import { GrowthIntelligenceService } from '../growth-intelligence/growth-intelligence.service';
import { Loyalty2LevelsService } from '../loyalty2/loyalty2-levels.service';
import { Loyalty2SettingsService } from '../loyalty2/loyalty2-settings.service';
import { CustomersRepository } from '../customers/customers.repository';
import { normalizeLoyaltyCode } from '../customers/loyalty-code';
import { LoyaltyCodeService } from '../customers/loyalty-code.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { PosterClientsService } from '../poster/poster-clients.service';
import { RewardProgramsService } from '../rewards/reward-programs.service';
import { StaffActor } from './staff-auth.service';
import { StaffSessionService } from './staff-session.service';
import { StaffRepository } from './staff.repository';

const RECENT_ORDERS_LIMIT = 5;
// Phase 16: Customer Search 2.0 — up to 20 rows (was 8), input capped so an oversized query is a 400 rather than a scan.
export const SEARCH_LIMIT = 20;
const MAX_QUERY_LENGTH = 100;

// One bounded snapshot — everything a barista needs after a scan, in ONE response. Privacy: no customer
// id, Telegram id/username, full phone, Poster client id, segment/campaign data or admin notes.
export interface StaffCustomerCard {
  displayName: string | null;
  publicCode: string;
  phoneLast4: string | null;
  loyalty: { balance: number } | null;
  rewards: { programName: string; threshold: number; qualifyingCount: number; remainingToNext: number; availableRewards: number }[];
  orders: {
    count: number;
    lastOrderAt: string | null;
    recent: { createdAt: string; status: OrderStatus; totalMinor: number; branchName: string | null }[];
  };
  poster: { state: 'LINKED' | 'NOT_LINKED' };
  // Honest operational note: progress/loyalty are computed from orders CUP knows about (orders placed
  // through the Mini App). Purchases rung up directly in the Poster POS are not imported yet.
  progressSource: 'CUP_ORDERS_ONLY';
  branch: { name: string } | null;
}

// Phase 16 (additive): the three original fields are unchanged; the rest is a compact, bulk-computed indicator (one aggregate query for the whole list).
export interface StaffSearchResult {
  displayName: string | null;
  publicCode: string;
  phoneLast4: string | null;
  phoneMasked: string | null;
  telegramUsername: string | null;
  level: string | null; // Loyalty 2.0 level name; null while the program is off or the customer has no level
  lifecycleState: string | null;
  lastPurchaseAt: string | null;
  daysSinceLastPurchase: number | null;
}

export interface StaffPosterCandidatesView {
  state: 'LINKED' | 'NOT_LINKED';
  candidates: { displayName: string; phoneLast4: string; choice: string }[];
}

// Read-mostly. The ONLY writes in this service are the audit rows and the explicit, non-overwriting
// Poster mapping (linkPosterClient). Nothing here touches loyalty balances, reward progress or orders —
// a scan/lookup is identity only, enforced by construction: no loyalty/reward/order mutation method is
// even injected.
@Injectable()
export class StaffCustomersService {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly loyaltyCodes: LoyaltyCodeService,
    private readonly loyalty: LoyaltyService,
    private readonly rewards: RewardProgramsService,
    private readonly metrics: CustomerMetricsService,
    private readonly posterClients: PosterClientsService,
    private readonly staffRepository: StaffRepository,
    private readonly sessions: StaffSessionService,
    private readonly growth: GrowthIntelligenceService,
    private readonly loyalty2Levels: Loyalty2LevelsService,
    private readonly loyalty2Settings: Loyalty2SettingsService,
  ) {}

  async lookupByCode(actor: StaffActor, rawCode: string): Promise<StaffCustomerCard> {
    const code = normalizeLoyaltyCode(rawCode);
    const customer = code ? await this.customers.findByLoyaltyCode(code) : null;
    if (!code || !customer) {
      await this.audit(actor, 'LOOKUP', 'NOT_FOUND', null);
      throw new NotFoundException('Customer not found.');
    }
    await this.audit(actor, 'LOOKUP', 'FOUND', customer.id);

    // Independent reads, issued together (no dependent chain, no per-row loops).
    const [loyaltySnapshot, rewardPrograms, orderData] = await Promise.all([
      this.loyalty.getAccountSnapshot(customer.id), // read-only: never creates an account / bonus
      this.rewards.listForCustomer(customer.id), // read-only derived progress
      this.metrics.getMetricsForCustomer(customer.id),
    ]);

    return {
      displayName: customer.displayName,
      publicCode: code,
      phoneLast4: last4(customer.phone),
      loyalty: loyaltySnapshot ? { balance: loyaltySnapshot.balance } : null,
      rewards: rewardPrograms.map((program) => ({
        programName: program.program.name,
        threshold: program.threshold,
        qualifyingCount: program.qualifyingCount,
        remainingToNext: Math.max(0, program.threshold - program.qualifyingCount),
        availableRewards: program.availableRewards,
      })),
      orders: {
        count: orderData.metrics.orderCount,
        lastOrderAt: orderData.metrics.lastOrderAt ? orderData.metrics.lastOrderAt.toISOString() : null,
        recent: orderData.orders.slice(0, RECENT_ORDERS_LIMIT).map((order) => ({
          createdAt: order.createdAt.toISOString(),
          status: order.status as OrderStatus,
          totalMinor: order.totalMinor,
          branchName: order.branch?.name ?? null,
        })),
      },
      poster: { state: customer.posterClientId ? 'LINKED' : 'NOT_LINKED' },
      progressSource: 'CUP_ORDERS_ONLY',
      branch: actor.branch ? { name: actor.branch.name } : null,
    };
  }

  // Fallback lookup (Phase 16: Search 2.0). Exact CUP code is preferred; a phone must be given in full and matches exactly under the existing
  // "+digits" convention — a 9-digit national number ("90 123 45 67") also resolves to +998…; names / Telegram usernames need >= 3 characters (a leading @ is
  // ignored). At most SEARCH_LIMIT rows, never a customer dump; the level / lifecycle / last purchase come from ONE bulk aggregate for the whole list.
  async search(actor: StaffActor, rawQuery: string): Promise<StaffSearchResult[]> {
    const query = rawQuery.trim();
    if (query.length < 3) throw new BadRequestException('Enter at least 3 characters.');
    if (query.length > MAX_QUERY_LENGTH) throw new BadRequestException('The search text is too long.');

    const asCode = normalizeLoyaltyCode(query);
    const digits = query.replace(/\D/g, '');
    let rows;
    if (asCode && query.toUpperCase().includes('CUP')) {
      const one = await this.customers.findByLoyaltyCode(asCode);
      rows = one ? [{ id: one.id, displayName: one.displayName, phone: one.phone, loyaltyCode: one.loyaltyCode, telegramAccount: one.telegramAccount ? { username: one.telegramAccount.username } : null }] : [];
    } else if (digits.length >= 7 && digits.length >= query.replace(/[\s+()-]/g, '').length) {
      rows = await this.customers.searchForStaff({ phoneVariants: phoneVariants(digits) }, SEARCH_LIMIT);
    } else {
      rows = await this.customers.searchForStaff({ nameContains: query.replace(/^@/, '') }, SEARCH_LIMIT);
    }

    const codes: string[] = [];
    for (const row of rows) codes.push(row.loyaltyCode ?? (await this.loyaltyCodes.ensureForCustomer(row.id)));

    const ids = rows.map((r) => r.id);
    const [indicators, loyalty2, levels] = await Promise.all([
      ids.length > 0 ? this.growth.getListIndicators(ids) : Promise.resolve(new Map()),
      this.loyalty2Settings.get(),
      this.loyalty2Levels.getActiveLevels(),
    ]);
    const results: StaffSearchResult[] = rows.map((row, i) => {
      const g = indicators.get(row.id);
      const levelName = loyalty2.enabled && g && g.lifetimePurchases > 0 ? (this.loyalty2Levels.resolve(levels, g.lifetimeRevenue).current?.name ?? null) : null;
      return {
        displayName: row.displayName,
        publicCode: codes[i],
        phoneLast4: last4(row.phone),
        phoneMasked: maskPhone(row.phone),
        telegramUsername: row.telegramAccount?.username ?? null,
        level: levelName,
        lifecycleState: g?.lifecycleState ?? null,
        lastPurchaseAt: g?.lastPurchaseAt ?? null,
        daysSinceLastPurchase: g?.daysSinceLastPurchase ?? null,
      };
    });
    await this.audit(actor, 'SEARCH', results.length > 0 ? 'FOUND' : 'NONE', null);
    return results;
  }

  // On-demand (NOT part of the scan snapshot, so a scan never waits on Poster). READ-ONLY Poster lookup by
  // exact phone. Several matches are returned as-is for the staff member to choose; nothing is selected.
  async posterCandidates(actor: StaffActor, rawCode: string): Promise<StaffPosterCandidatesView> {
    const customer = await this.requireCustomer(rawCode);
    if (customer.posterClientId) return { state: 'LINKED', candidates: [] };
    if (!customer.phone) return { state: 'NOT_LINKED', candidates: [] };

    const found = await this.posterClients.findCandidatesByPhone(customer.phone);
    await this.audit(actor, 'POSTER_LOOKUP', found.length === 0 ? 'NONE' : found.length === 1 ? 'ONE' : 'MULTIPLE', customer.id);
    return {
      state: 'NOT_LINKED',
      candidates: found.map((c) => ({ displayName: c.displayName, phoneLast4: c.phoneLast4, choice: this.choiceToken(customer.id, c.clientId) })),
    };
  }

  // Explicit, auditable, idempotent, NEVER overwriting. The browser sends only an opaque `choice` token; the
  // server re-fetches the current Poster matches for the customer's own phone and links only a client that is
  // in that list — so an arbitrary Poster id can never be linked.
  async linkPosterClient(actor: StaffActor, rawCode: string, choice: string): Promise<{ state: 'LINKED'; changed: boolean }> {
    const customer = await this.requireCustomer(rawCode);
    if (customer.posterClientId) {
      await this.audit(actor, 'POSTER_LINK', 'ALREADY_LINKED', customer.id);
      return { state: 'LINKED', changed: false };
    }
    if (!customer.phone) throw new BadRequestException('Customer has no phone to match against Poster.');

    const found = await this.posterClients.findCandidatesByPhone(customer.phone);
    const chosen = found.find((c) => this.choiceToken(customer.id, c.clientId) === choice);
    if (!chosen) {
      await this.audit(actor, 'POSTER_LINK', 'CHOICE_INVALID', customer.id);
      throw new ConflictException('That Poster match is no longer available. Search again.');
    }

    try {
      const changed = await this.customers.setPosterClientIfMissing(customer.id, chosen.clientId);
      await this.audit(actor, 'POSTER_LINK', changed ? 'LINKED' : 'ALREADY_LINKED', customer.id);
      return { state: 'LINKED', changed };
    } catch (err) {
      if (isUniqueViolation(err)) {
        await this.audit(actor, 'POSTER_LINK', 'CONFLICT', customer.id);
        throw new ConflictException('That Poster customer is already linked to another CUP customer.');
      }
      throw err;
    }
  }

  private async requireCustomer(rawCode: string) {
    const code = normalizeLoyaltyCode(rawCode);
    const customer = code ? await this.customers.findByLoyaltyCode(code) : null;
    if (!customer) throw new NotFoundException('Customer not found.');
    return customer;
  }

  // Opaque and bound to ONE customer: a token issued for customer A is worthless for customer B.
  private choiceToken(customerId: string, posterClientId: string): string {
    return createHmac('sha256', this.sessions.deriveLabelledKey('poster-link-choice-v1')).update(`${customerId}:${posterClientId}`).digest('hex').slice(0, 24);
  }

  private audit(actor: StaffActor, action: string, result: string, customerId: string | null) {
    return this.staffRepository.recordEvent({ actorType: actor.kind, actorId: actor.id, action, result, customerId, branchId: actor.branch?.id ?? null });
  }
}

// The stored convention is "+" + digits (see normalizeTelegramPhone). A typed query may arrive with or without the plus, with separators, or as the
// 9-digit national number; every plausible stored form is tried, exact match only.
export function phoneVariants(digits: string): string[] {
  const out = new Set<string>([`+${digits}`, digits]);
  if (digits.length === 9) {
    out.add(`+998${digits}`);
    out.add(`998${digits}`);
  }
  return [...out];
}

function last4(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'P2002';
}
