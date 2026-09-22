import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '../../common/config/config.service';
import { addDays, businessDateOf, parseBusinessDate, rangeFor } from '../analytics/analytics-period';
import { Loyalty2LevelsService } from '../loyalty2/loyalty2-levels.service';
import { resolveLevel } from '../loyalty2/loyalty2-math';
import { Loyalty2SettingsService } from '../loyalty2/loyalty2-settings.service';
import { ReferralSettingsService } from '../referrals/referral-settings.service';
import { ReferralsService } from '../referrals/referrals.service';
import { RewardProgramsService } from '../rewards/reward-programs.service';
import { GrowthIntelligenceRepository } from './growth-intelligence.repository';
import {
  OpportunityContext,
  SignalExtras,
  computeMetrics,
  RECOMMENDATIONS,
  deriveOpportunities,
  deriveSignals,
  emptyMetrics,
  priorityRank,
} from './growth-intelligence.rules';
import {
  CANDIDATE_TYPES,
  CandidateType,
  GrowthMetrics,
  GrowthOpportunity,
  GrowthSettings,
  GrowthSignal,
  LIFECYCLE_STATES,
  LifecycleState,
  OPPORTUNITY_TYPES,
  SIGNAL_TYPES,
  OpportunityType,
  SignalType,
} from './growth-intelligence.types';
import { GrowthSettingsService } from './growth-settings.service';

const DAY_MS = 86_400_000;
const LIST_LIMIT = 10;
const FEED_LIMIT = 20;

export interface PeriodInput {
  days?: number;
  from?: string; // custom range, business-local YYYY-MM-DD (inclusive)
  to?: string;
}

export interface ViewOptions {
  period?: PeriodInput;
  branchId?: string | null;
  now?: Date;
  allowInactiveBranch?: boolean; // Phase 18: a historical branch view may name a deactivated branch
}

interface Lookback {
  from: Date;
  to: Date;
  label: { mode: 'days' | 'custom'; days: number; startDate: string; endDate: string };
}

// What a Segment condition can read about a customer (see segment-condition-allowlist.ts). null = "no data": a condition on it never matches.
export interface SegmentGrowthMetrics {
  recencyDays: number | null;
  daysSinceLastPurchase: number | null;
  daysSinceFirstPurchase: number | null;
  frequency: number | null;
  monetary: number | null;
  recencyScore: number | null;
  frequencyScore: number | null;
  monetaryScore: number | null;
  rfmTotal: number | null;
  lifetimeRevenue: number | null;
  lifetimePurchases: number | null;
  lifecycleState: string | null;
  rfmScore: string | null;
  growthSignals: string[] | null; // null when signals were not requested
}

interface FullProfile {
  metrics: GrowthMetrics;
  signals: GrowthSignal[];
  opportunities: GrowthOpportunity[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

// Phase 15 — Growth Intelligence. DETERMINISTIC and explainable: nothing here predicts, scores with a model or sends anything. It is the ONE
// implementation of RFM / lifecycle / signals / opportunities; Customer 360, the Customers list, Segments and the Admin dashboard all call it, so
// the definitions cannot drift. Everything is derived on demand from the canonical purchases (one bulk aggregate query — never a query per customer,
// never a Poster call) and the configured thresholds; there is no cache and nothing is stored (see DECISIONS D15-1 / D15-9).
@Injectable()
export class GrowthIntelligenceService {
  constructor(
    private readonly repository: GrowthIntelligenceRepository,
    private readonly settings: GrowthSettingsService,
    private readonly config: ConfigService,
    private readonly rewardPrograms: RewardProgramsService,
    private readonly levels: Loyalty2LevelsService,
    private readonly loyalty2Settings: Loyalty2SettingsService,
    private readonly referralSettings: ReferralSettingsService,
    private readonly referrals: ReferralsService,
  ) {}

  private get offset(): number {
    return this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
  }

  // ------------------------------------------------------------------------------------------------------------------ period / branch

  private lookback(period: PeriodInput | undefined, now: Date, s: GrowthSettings): Lookback {
    const today = businessDateOf(now, this.offset);
    if (period?.from || period?.to) {
      if (!period.from || !period.to || !parseBusinessDate(period.from) || !parseBusinessDate(period.to)) throw new BadRequestException('A custom period needs valid from and to dates (YYYY-MM-DD).');
      if (period.from > period.to) throw new BadRequestException('from must not be after to.');
      const r = rangeFor(period.from, period.to, this.offset);
      if (r.days > 3650) throw new BadRequestException('A custom period may not exceed 3650 days.');
      return { from: r.from, to: r.to, label: { mode: 'custom', days: r.days, startDate: r.startDate, endDate: r.endDate } };
    }
    const days = period?.days ?? s.lookbackDays;
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new BadRequestException('The lookback must be between 1 and 3650 days.');
    const r = rangeFor(addDays(today, -(days - 1)), today, this.offset);
    return { from: r.from, to: r.to, label: { mode: 'days', days, startDate: r.startDate, endDate: r.endDate } };
  }

  private async resolveBranch(branchId: string | null | undefined, allowInactive = false): Promise<{ id: string; name: string } | null> {
    if (!branchId) return null;
    const branch = allowInactive ? await this.repository.findBranch(branchId) : await this.repository.findActiveBranch(branchId);
    if (!branch) throw new BadRequestException('Unknown or inactive branch.');
    return branch;
  }

  // ------------------------------------------------------------------------------------------------------------------ core computation

  private async metricsFor(ids: string[] | null, s: GrowthSettings, lb: Lookback, now: Date, branchId: string | null): Promise<Map<string, GrowthMetrics>> {
    const rows = await this.repository.aggregates({ customerIds: ids ?? undefined, branchId, lookbackFrom: lb.from, lookbackTo: lb.to, highValueRevenue: s.highValueRevenue });
    const out = new Map<string, GrowthMetrics>();
    for (const r of rows) out.set(r.customerId, computeMetrics(r, s, now.getTime(), this.offset));
    if (ids) for (const id of ids) if (!out.has(id)) out.set(id, emptyMetrics());
    return out;
  }

  private async loadExtras(ids: string[], s: GrowthSettings, now: Date): Promise<Map<string, SignalExtras>> {
    const out = new Map<string, SignalExtras>();
    if (ids.length === 0) return out;
    const wanted = new Set(ids);
    const extras = (id: string) => {
      let e = out.get(id);
      if (!e) out.set(id, (e = {}));
      return e;
    };
    const since = new Date(now.getTime() - s.signalWindowDays * DAY_MS);
    const [rewards, refs, levelUps, birthdays, loyalty2] = await Promise.all([
      this.rewardPrograms.availableRewardsForCustomers(ids),
      this.repository.qualifiedReferralsSince(since),
      this.repository.levelUpsSince(since),
      s.birthdayLookaheadDays >= 0 ? this.repository.birthdays(ids) : Promise.resolve([]),
      this.loyalty2Settings.get(),
    ]);
    for (const [id, list] of rewards) extras(id).rewards = list;
    for (const r of refs) if (wanted.has(r.referrerCustomerId)) (extras(r.referrerCustomerId).referrals ??= []).push({ referralId: r.referralId, qualifiedAt: r.qualifiedAt });
    if (loyalty2.enabled) for (const l of levelUps) if (wanted.has(l.customerId)) (extras(l.customerId).levelUps ??= []).push({ levelCode: l.levelCode, levelName: l.levelName, reachedAt: l.reachedAt });
    for (const b of birthdays) if (wanted.has(b.customerId)) extras(b.customerId).birthDate = b.birthDate;
    return out;
  }

  private async opportunityContext(): Promise<{ referralEnabled: boolean; levels: Awaited<ReturnType<Loyalty2LevelsService['getActiveLevels']>> | null }> {
    const [referralEnabled, loyalty2] = await Promise.all([this.referralSettings.isEnabled(), this.loyalty2Settings.get()]);
    return { referralEnabled, levels: loyalty2.enabled ? await this.levels.getActiveLevels() : null };
  }

  private full(id: string, m: GrowthMetrics, extras: SignalExtras | undefined, oc: Awaited<ReturnType<GrowthIntelligenceService['opportunityContext']>>, s: GrowthSettings, now: Date, withUpgrade: boolean): FullProfile {
    const signals = deriveSignals(id, m, extras ?? {}, s, now.getTime(), this.offset);
    let upgrade: OpportunityContext['upgrade'] = null;
    if (withUpgrade && oc.levels && m.lifetimePurchases > 0) {
      const next = resolveLevel(oc.levels, m.lifetimeRevenue).next;
      if (next && next.minLifetimeSpend > 0) upgrade = { levelName: next.name, spendToNext: next.minLifetimeSpend - m.lifetimeRevenue, percentReached: Math.floor((m.lifetimeRevenue / next.minLifetimeSpend) * 100) };
    }
    return { metrics: m, signals, opportunities: deriveOpportunities(m, signals, { referralEnabled: oc.referralEnabled, upgrade }, s) };
  }

  // ------------------------------------------------------------------------------------------------------------------ for Segments

  // Bulk growth fields for a set of customers (all branches, the configured default lookback). Signals (extra queries) only when a segment asks.
  async getSegmentMetrics(ids: string[], options: { signals: boolean; now?: Date }): Promise<Map<string, SegmentGrowthMetrics>> {
    const now = options.now ?? new Date();
    const s = await this.settings.get();
    const lb = this.lookback(undefined, now, s);
    const metrics = await this.metricsFor(ids, s, lb, now, null);
    const extras = options.signals ? await this.loadExtras(ids, s, now) : null;
    const out = new Map<string, SegmentGrowthMetrics>();
    for (const [id, m] of metrics) {
      out.set(id, {
        recencyDays: m.daysSinceLastPurchase,
        daysSinceLastPurchase: m.daysSinceLastPurchase,
        daysSinceFirstPurchase: m.daysSinceFirstPurchase,
        frequency: m.frequency,
        monetary: m.monetary,
        recencyScore: m.recencyScore,
        frequencyScore: m.frequencyScore,
        monetaryScore: m.monetaryScore,
        rfmTotal: m.rfmTotal,
        lifetimeRevenue: m.lifetimeRevenue,
        lifetimePurchases: m.lifetimePurchases,
        lifecycleState: m.lifecycleState,
        rfmScore: m.rfmScore,
        growthSignals: extras ? deriveSignals(id, m, extras.get(id) ?? {}, s, now.getTime(), this.offset).map((x) => x.type) : null,
      });
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------------------------ Customers list

  // Compact per-row indicators for one page of customers: ONE aggregate query for the whole page.
  async getListIndicators(ids: string[], now: Date = new Date()) {
    const s = await this.settings.get();
    const metrics = await this.metricsFor(ids, s, this.lookback(undefined, now, s), now, null);
    const out = new Map<string, { lifecycleState: LifecycleState | null; rfmScore: string | null; lastPurchaseAt: string | null; daysSinceLastPurchase: number | null; lifetimeRevenue: number; lifetimePurchases: number }>();
    for (const [id, m] of metrics) out.set(id, { lifecycleState: m.lifecycleState, rfmScore: m.rfmScore, lastPurchaseAt: iso(m.lastPurchaseAt), daysSinceLastPurchase: m.daysSinceLastPurchase, lifetimeRevenue: m.lifetimeRevenue, lifetimePurchases: m.lifetimePurchases });
    return out;
  }

  // ------------------------------------------------------------------------------------------------------------------ Customer 360

  // Read-only descriptive block for ONE customer (all branches, the configured default lookback). Never creates or changes anything.
  // Phase 16: `branchId` (optional) gives the SAME block computed only from purchases at that branch (the Phase 15 branch rule) — Staff shows it next to the
  // all-branches block, clearly labelled, so branch metrics never silently become global ones.
  async getCustomerBlock(customerId: string, now: Date = new Date(), branchId: string | null = null) {
    const s = await this.settings.get();
    const lb = this.lookback(undefined, now, s);
    const metrics = await this.metricsFor([customerId], s, lb, now, branchId);
    const m = metrics.get(customerId) ?? emptyMetrics();
    const [extras, oc] = await Promise.all([this.loadExtras([customerId], s, now), this.opportunityContext()]);
    const p = this.full(customerId, m, extras.get(customerId), oc, s, now, true);
    return {
      lifecycleState: m.lifecycleState,
      rfm: m.rfmScore ? { score: m.rfmScore, recency: m.recencyScore, frequency: m.frequencyScore, monetary: m.monetaryScore, total: m.rfmTotal } : null,
      recencyDays: m.daysSinceLastPurchase,
      frequency: m.frequency,
      monetary: m.monetary,
      lookbackDays: lb.label.days,
      lifetimePurchases: m.lifetimePurchases,
      lifetimeRevenue: m.lifetimeRevenue,
      firstPurchaseAt: iso(m.firstPurchaseAt),
      lastPurchaseAt: iso(m.lastPurchaseAt),
      signals: p.signals.map((x) => ({ type: x.type, severity: x.severity, detectedAt: iso(x.detectedAt), reason: x.reason })),
      opportunities: p.opportunities,
    };
  }

  // ------------------------------------------------------------------------------------------------------------------ Admin dashboard

  async overview(options: ViewOptions = {}) {
    const now = options.now ?? new Date();
    const s = await this.settings.get();
    const lb = this.lookback(options.period, now, s);
    const branch = await this.resolveBranch(options.branchId, options.allowInactiveBranch);
    const metrics = await this.metricsFor(null, s, lb, now, branch?.id ?? null);
    const ids = [...metrics.keys()];
    const [extras, oc, totalCustomers, referralSummary] = await Promise.all([
      this.loadExtras(ids, s, now),
      this.opportunityContext(),
      branch ? Promise.resolve(null) : this.repository.customerCount(),
      this.referrals.adminSummary(),
    ]);

    const lifecycle = Object.fromEntries(LIFECYCLE_STATES.map((k) => [k, 0])) as Record<LifecycleState, number>;
    const hist = { recency: [0, 0, 0, 0, 0], frequency: [0, 0, 0, 0, 0], monetary: [0, 0, 0, 0, 0] };
    const matrix = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]); // [recencyScore-1][frequencyScore-1]
    const codes = new Map<string, number>();
    const signalCounts = Object.fromEntries(SIGNAL_TYPES.map((k) => [k, 0])) as Record<SignalType, number>;
    const oppCounts = Object.fromEntries(OPPORTUNITY_TYPES.map((k) => [k, { total: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }])) as Record<OpportunityType, { total: number; HIGH: number; MEDIUM: number; LOW: number }>;
    const feed: { id: string; signal: GrowthSignal }[] = [];
    const oppList: { id: string; opp: GrowthOpportunity; revenue: number }[] = [];
    let highValue = 0;
    let withRewards = 0;

    for (const [id, m] of metrics) {
      if (m.lifecycleState) lifecycle[m.lifecycleState] += 1;
      if (m.recencyScore && m.frequencyScore && m.monetaryScore) {
        hist.recency[m.recencyScore - 1] += 1;
        hist.frequency[m.frequencyScore - 1] += 1;
        hist.monetary[m.monetaryScore - 1] += 1;
        matrix[m.recencyScore - 1][m.frequencyScore - 1] += 1;
        codes.set(m.rfmScore!, (codes.get(m.rfmScore!) ?? 0) + 1);
      }
      if (m.highValue) highValue += 1;
      // The upgrade opportunity uses lifetime spend, which is only the customer's true lifetime figure in the all-branches view.
      const p = this.full(id, m, extras.get(id), oc, s, now, !branch);
      if (extras.get(id)?.rewards?.some((r) => r.available > 0)) withRewards += 1;
      for (const sig of p.signals) {
        signalCounts[sig.type] += 1;
        feed.push({ id, signal: sig });
      }
      for (const opp of p.opportunities) {
        oppCounts[opp.type].total += 1;
        oppCounts[opp.type][opp.priority] += 1;
        oppList.push({ id, opp, revenue: m.lifetimeRevenue });
      }
    }

    feed.sort((a, b) => (b.signal.detectedAt?.getTime() ?? -1) - (a.signal.detectedAt?.getTime() ?? -1) || (a.signal.key < b.signal.key ? -1 : 1));
    oppList.sort((a, b) => priorityRank(a.opp.priority) - priorityRank(b.opp.priority) || OPPORTUNITY_TYPES.indexOf(a.opp.type) - OPPORTUNITY_TYPES.indexOf(b.opp.type) || b.revenue - a.revenue || (a.id < b.id ? -1 : 1));

    const byRevenue = (a: [string, GrowthMetrics], b: [string, GrowthMetrics]) => b[1].lifetimeRevenue - a[1].lifetimeRevenue || (a[0] < b[0] ? -1 : 1);
    const entries = [...metrics.entries()];
    const topHigh = entries.filter(([, m]) => m.highValue).sort(byRevenue).slice(0, LIST_LIMIT);
    const topAtRisk = entries.filter(([, m]) => m.lifecycleState === 'AT_RISK').sort(byRevenue).slice(0, LIST_LIMIT);
    const topNew = entries.filter(([, m]) => m.lifecycleState === 'NEW').sort((a, b) => (b[1].firstPurchaseAt?.getTime() ?? 0) - (a[1].firstPurchaseAt?.getTime() ?? 0) || (a[0] < b[0] ? -1 : 1)).slice(0, LIST_LIMIT);
    const rising = feed.filter((f) => f.signal.type === 'RISING_CUSTOMER').slice(0, LIST_LIMIT).map((f) => [f.id, metrics.get(f.id)!] as [string, GrowthMetrics]);

    const shown = new Set<string>([...topHigh, ...topAtRisk, ...topNew, ...rising].map(([id]) => id));
    for (const f of feed.slice(0, FEED_LIMIT)) shown.add(f.id);
    for (const o of oppList.slice(0, FEED_LIMIT)) shown.add(o.id);
    const names = await this.repository.customerNames([...shown]);
    const nameOf = (id: string) => ({ displayName: names.get(id) ?? null });
    const row = ([id, m]: [string, GrowthMetrics]) => ({
      customer: nameOf(id),
      lifecycleState: m.lifecycleState,
      rfmScore: m.rfmScore,
      daysSinceLastPurchase: m.daysSinceLastPurchase,
      lastPurchaseAt: iso(m.lastPurchaseAt),
      lifetimePurchases: m.lifetimePurchases,
      lifetimeRevenue: m.lifetimeRevenue,
    });

    const lifecycleTotal = LIFECYCLE_STATES.reduce((n, k) => n + lifecycle[k], 0);
    return {
      asOf: now.toISOString(),
      range: lb.label,
      branch,
      thresholds: s,
      kpis: {
        totalCustomers, // null in a branch view
        customersWithPurchases: metrics.size,
        neverPurchased: totalCustomers === null ? null : Math.max(0, totalCustomers - metrics.size),
        activeCustomers: lifecycle.NEW + lifecycle.ACTIVE + lifecycle.LOYAL,
        newCustomers: lifecycle.NEW,
        loyalCustomers: lifecycle.LOYAL,
        atRiskCustomers: lifecycle.AT_RISK,
        dormantCustomers: lifecycle.DORMANT,
        churnedCustomers: lifecycle.CHURNED,
        highValueCustomers: highValue,
        customersWithRewards: withRewards,
        successfulReferrals: (referralSummary.byStatus.QUALIFIED ?? 0) + (referralSummary.byStatus.REWARDED ?? 0),
      },
      lifecycle: { total: lifecycleTotal, counts: lifecycle },
      rfm: {
        histograms: hist,
        matrix, // rows = recency score 1..5, columns = frequency score 1..5
        topScores: [...codes.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8).map(([score, customers]) => ({ score, customers })),
      },
      signals: {
        counts: signalCounts,
        latest: feed.slice(0, FEED_LIMIT).map((f) => ({ type: f.signal.type, severity: f.signal.severity, detectedAt: iso(f.signal.detectedAt), reason: f.signal.reason, customer: nameOf(f.id) })),
      },
      opportunities: {
        counts: oppCounts,
        recommendations: RECOMMENDATIONS,
        top: oppList.slice(0, FEED_LIMIT).map((o) => ({ type: o.opp.type, priority: o.opp.priority, reason: o.opp.reason, recommended: o.opp.recommended, customer: nameOf(o.id) })),
      },
      lists: { highValue: topHigh.map(row), atRisk: topAtRisk.map(row), newCustomers: topNew.map(row), rising: rising.map(row) },
    };
  }

  // ------------------------------------------------------------------------------------------------------------------ CRM trigger candidates

  // READ-ONLY foundation for a future Phase 13 trigger: the customers that currently meet a rule, each with a deterministic event key. Nothing here
  // creates an automation, queues anything or sends anything. The public `eventKey` / cursor are a stable hash of the internal identity key (which
  // contains the customer id), so the Admin API never exposes a raw customer id; a server-side consumer asks for `internal: true` to get the real key
  // and customer id.
  async candidates(type: CandidateType, options: { cursor?: string; limit: number; now?: Date; internal?: boolean }) {
    if (!CANDIDATE_TYPES.includes(type)) throw new BadRequestException('Unknown candidate type.');
    const now = options.now ?? new Date();
    const s = await this.settings.get();
    const metrics = await this.metricsFor(null, s, this.lookback(undefined, now, s), now, null);
    const ids = [...metrics.keys()];
    const oc = await this.opportunityContext();
    const extras = type === 'CUSTOMER_BIRTHDAY_UPCOMING' ? await this.loadExtras(ids, s, now) : new Map<string, SignalExtras>();
    const wantSignal: Partial<Record<CandidateType, SignalType>> = { CUSTOMER_AT_RISK: 'AT_RISK', CUSTOMER_DORMANT: 'DORMANT', CUSTOMER_HIGH_VALUE: 'HIGH_VALUE_CUSTOMER', CUSTOMER_BIRTHDAY_UPCOMING: 'BIRTHDAY_UPCOMING' };

    const found: { id: string; key: string; at: Date | null; reason: string }[] = [];
    for (const [id, m] of metrics) {
      if (type === 'CUSTOMER_SECOND_PURCHASE_DUE') {
        const opp = deriveOpportunities(m, [], { referralEnabled: false, upgrade: null }, s).find((o) => o.type === 'SECOND_PURCHASE' && o.priority === 'MEDIUM');
        if (opp && m.firstPurchaseAt) found.push({ id, key: `second-purchase-due:${id}`, at: new Date(m.firstPurchaseAt.getTime() + s.secondPurchaseDueDays * DAY_MS), reason: opp.reason });
        continue;
      }
      const sig = this.full(id, m, extras.get(id), oc, s, now, false).signals.find((x) => x.type === wantSignal[type]);
      if (sig) found.push({ id, key: sig.key, at: sig.detectedAt, reason: sig.reason });
    }
    found.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0) || (a.key < b.key ? -1 : 1));
    const ref = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 20);
    const start = options.cursor ? found.findIndex((f) => (options.internal ? f.key : ref(f.key)) === options.cursor) + 1 : 0;
    const page = found.slice(start, start + options.limit);
    const names = await this.repository.customerNames(page.map((p) => p.id));
    return {
      type,
      total: found.length,
      items: page.map((p) => ({
        eventKey: `growth:${type}:${options.internal ? p.key : ref(p.key)}`,
        ...(options.internal ? { customerId: p.id } : {}),
        customer: { displayName: names.get(p.id) ?? null },
        at: iso(p.at),
        reason: p.reason,
      })),
      nextCursor: start + options.limit < found.length && page.length > 0 ? (options.internal ? page[page.length - 1].key : ref(page[page.length - 1].key)) : null,
    };
  }

  getSettings(): Promise<GrowthSettings> {
    return this.settings.get();
  }

  async listBranches() {
    return this.repository.listActiveBranches();
  }
}
