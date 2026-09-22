import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { isForeignKeyConstraintViolation } from '../../common/util/prisma-errors';
import { BranchRepository } from '../branches/branch.repository';
import { CustomerMetricsService } from '../customer-metrics/customer-metrics.service';
import { GrowthIntelligenceService, SegmentGrowthMetrics } from '../growth-intelligence/growth-intelligence.service';
import { LIFECYCLE_STATES, SIGNAL_TYPES, isGrowthField } from '../growth-intelligence/growth-intelligence.types';
import { LoyaltyService } from '../loyalty/loyalty.service';
import {
  isSegmentField,
  isSegmentOperator,
  SEGMENT_FIELD_DEFINITIONS,
  SegmentField,
  SegmentOperator,
} from './segment-condition-allowlist';
import { CustomerSegmentMetrics, evaluateSegment } from './segment-evaluator';
import { CreateSegmentInput, UpdateSegmentInput } from './segments.dto';
import { PersistedCondition, SegmentsRepository } from './segments.repository';

export interface SegmentConditionView {
  field: SegmentField;
  operator: SegmentOperator;
  value: string;
}

export interface SegmentView {
  id: string;
  name: string;
  description: string | null;
  logic: 'AND' | 'OR';
  conditions: SegmentConditionView[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentListPage {
  items: SegmentView[];
  nextCursor: string | null;
}

export interface SegmentMatchingCustomer {
  id: string;
  displayName: string | null;
  phone: string | null;
  username: string | null;
  orderCount: number;
  totalSpentMinor: number;
  averageOrderMinor: number;
  lastOrderAt: string | null;
  favoriteBranch: string | null;
  loyaltyBalance: number;
}

export interface SegmentMatchingCustomersPage {
  items: SegmentMatchingCustomer[];
  nextCursor: string | null;
}

interface SegmentRow {
  id: string;
  name: string;
  description: string | null;
  logic: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  conditions: { field: string; operator: string; value: string }[];
}

@Injectable()
export class SegmentsService {
  constructor(
    private readonly repository: SegmentsRepository,
    private readonly branchRepository: BranchRepository,
    private readonly customerMetricsService: CustomerMetricsService,
    private readonly loyaltyService: LoyaltyService,
    private readonly growthService: GrowthIntelligenceService,
  ) {}

  async list(options: { cursor?: string; limit: number }): Promise<SegmentListPage> {
    const rows = await this.repository.findMany({ cursor: options.cursor, take: options.limit + 1 });
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      items: pageRows.map(toSegmentView),
      nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    };
  }

  async getById(id: string): Promise<SegmentView | null> {
    const row = await this.repository.findById(id);
    return row ? toSegmentView(row) : null;
  }

  async create(input: CreateSegmentInput, adminId: string): Promise<SegmentView> {
    const conditions = await this.validateConditions(input.conditions);
    const created = await this.repository.create({
      name: input.name,
      description: input.description ?? null,
      logic: input.logic,
      isActive: input.isActive ?? true,
      conditions,
      createdBy: adminId,
    });
    return toSegmentView(created);
  }

  async update(id: string, input: UpdateSegmentInput, adminId: string): Promise<SegmentView | null> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      return null;
    }
    const conditions = input.conditions !== undefined ? await this.validateConditions(input.conditions) : undefined;
    const updated = await this.repository.update(id, {
      name: input.name,
      description: input.description,
      logic: input.logic,
      isActive: input.isActive,
      conditions,
      updatedBy: adminId,
    });
    return toSegmentView(updated);
  }

  // "Admin deletes them only if safe": SegmentCondition rows cascade automatically, but as of
  // Phase 6 a Segment can also be referenced by a Campaign (Campaign.segmentId, no onDelete
  // override — see schema.prisma), which the database itself refuses to let this delete break.
  // Rather than let that raw Prisma foreign-key error reach the API, it's caught here and turned
  // into a clean 409. Deliberately does NOT import anything from the campaigns module to check
  // this proactively — that would invert this project's one-directional module dependency rule
  // (Campaigns -> Segments, never the reverse); reacting to the database's own constraint keeps
  // SegmentsModule fully independent of Campaigns. Returns false only when the segment doesn't
  // exist, for the controller to map to a 404.
  async delete(id: string): Promise<boolean> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      return false;
    }
    try {
      await this.repository.delete(id);
    } catch (err) {
      if (isForeignKeyConstraintViolation(err)) {
        throw new ConflictException('This segment is used by one or more campaigns and cannot be deleted.');
      }
      throw err;
    }
    return true;
  }

  // Phase 5's documented scale tradeoff: evaluates every customer's metrics against the
  // segment's conditions in application code, rather than translating each condition into a
  // Prisma WHERE clause pushed to SQL. The heavy work (order aggregation, branch-favorite
  // reduction, loyalty lookup) is still done in a small, FIXED number of bounded queries
  // (never N+1, never one query per customer — see CustomerMetricsService.getBulkMetrics and
  // LoyaltyService.getAccountSnapshotsForCustomers), so this scales with query count, not
  // customer count. What it does NOT yet do is avoid holding every customer's computed metrics
  // in memory for the duration of one request — acceptable for this foundation phase's explicit
  // instruction to prioritize correctness/maintainability over premature optimization, and to
  // defer cached segment membership tables and background jobs. A future phase at much larger
  // scale would want per-condition SQL translation or a materialized membership table instead.
  async getMatchingCustomers(
    segmentId: string,
    options: { cursor?: string; limit: number },
  ): Promise<SegmentMatchingCustomersPage | null> {
    const segment = await this.repository.findById(segmentId);
    if (!segment) {
      return null;
    }

    const allCustomers = await this.customerMetricsService.findAllCustomerIds();
    const allCustomerIds = allCustomers.map((c) => c.id);
    const [bulkMetrics, loyaltySnapshots] = await Promise.all([
      this.customerMetricsService.getBulkMetrics(allCustomerIds),
      this.loyaltyService.getAccountSnapshotsForCustomers(allCustomerIds),
    ]);

    const growth = await this.growthFor([segment], allCustomerIds);
    const matchingIds = filterMatchingIds(segment, allCustomerIds, bulkMetrics, loyaltySnapshots, growth);

    // Cursor pagination over the filtered, sorted id list — deterministic without a second
    // query. If the cursor is no longer present (e.g. the segment's own definition changed
    // between page fetches, changing who matches), this safely restarts from the beginning
    // rather than erroring.
    const cursorIndex = options.cursor ? matchingIds.indexOf(options.cursor) : -1;
    const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const pageIds = matchingIds.slice(startIndex, startIndex + options.limit + 1);
    const hasMore = pageIds.length > options.limit;
    const pageIdsTrimmed = hasMore ? pageIds.slice(0, options.limit) : pageIds;

    const profiles = await this.repository.findCustomerProfilesByIds(pageIdsTrimmed);
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    return {
      items: pageIdsTrimmed.map((id) => {
        const profile = profileById.get(id);
        const orderMetrics = bulkMetrics.get(id)!;
        const loyalty = loyaltySnapshots.get(id) ?? { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 };
        return {
          id,
          displayName: profile?.displayName ?? null,
          phone: profile?.phone ?? null,
          username: profile?.telegramAccount?.username ?? null,
          orderCount: orderMetrics.metrics.orderCount,
          totalSpentMinor: orderMetrics.metrics.totalSpentMinor,
          averageOrderMinor: orderMetrics.metrics.averageOrderMinor,
          lastOrderAt: orderMetrics.metrics.lastOrderAt ? orderMetrics.metrics.lastOrderAt.toISOString() : null,
          favoriteBranch: orderMetrics.favoriteBranch,
          loyaltyBalance: loyalty.balance,
        };
      }),
      nextCursor: hasMore ? pageIdsTrimmed[pageIdsTrimmed.length - 1] : null,
    };
  }

  // Phase 11.4: which ACTIVE segments ONE customer currently matches, for Customer 360. Dynamic evaluation stays
  // authoritative (nothing is stored): one query for the active definitions, the same bulk metric/loyalty lookups
  // getMatchingCustomers uses but for a single id, then the SAME filterMatchingIds/evaluator per segment in memory — no
  // query per segment. Segment metrics are order-derived CUP metrics (Phase 5), so they do not include POS purchases.
  async listMatchingForCustomer(customerId: string): Promise<{ name: string; description: string | null }[]> {
    const segments = await this.repository.findActive();
    if (segments.length === 0) {
      return [];
    }
    const [bulkMetrics, loyaltySnapshots] = await Promise.all([
      this.customerMetricsService.getBulkMetrics([customerId]),
      this.loyaltyService.getAccountSnapshotsForCustomers([customerId]),
    ]);
    const growth = await this.growthFor(segments, [customerId]);
    return segments
      .filter((segment) => filterMatchingIds(segment, [customerId], bulkMetrics, loyaltySnapshots, growth).length === 1)
      .map((segment) => ({ name: segment.name, description: segment.description }));
  }

  // Phase 13: which of the GIVEN customers currently match a segment — the batch counterpart of listMatchingForCustomer, used by CRM automation
  // to filter one bounded batch of candidates. Dynamic evaluation stays authoritative and nothing is stored: a fixed number of bulk lookups for
  // the given ids (never per customer), then the SAME evaluator in memory. Returns null when the segment does not exist.
  async filterCustomersInSegment(segmentId: string, customerIds: string[]): Promise<Set<string> | null> {
    const segment = await this.repository.findById(segmentId);
    if (!segment) {
      return null;
    }
    if (customerIds.length === 0) {
      return new Set();
    }
    const [bulkMetrics, loyaltySnapshots] = await Promise.all([
      this.customerMetricsService.getBulkMetrics(customerIds),
      this.loyaltyService.getAccountSnapshotsForCustomers(customerIds),
    ]);
    const growth = await this.growthFor([segment], customerIds);
    return new Set(filterMatchingIds(segment, customerIds, bulkMetrics, loyaltySnapshots, growth));
  }

  // Phase 6: the full (unpaginated) matching-customer-id list for a segment — used by
  // CampaignAudienceService to resolve a campaign's audience. Reuses the exact same evaluation
  // path as getMatchingCustomers above (filterMatchingIds), never a second, competing
  // implementation of segment evaluation. Returns null only when the segment doesn't exist.
  // Callers needing customer profile data (name/phone) or Telegram eligibility are responsible
  // for their own bulk lookups by these ids — this method deliberately stays scoped to "which
  // customers match," the same separation of concerns SegmentsService already has from
  // CustomerMetricsService/LoyaltyService.
  async getAllMatchingCustomerIds(segmentId: string): Promise<string[] | null> {
    const segment = await this.repository.findById(segmentId);
    if (!segment) {
      return null;
    }
    const allCustomers = await this.customerMetricsService.findAllCustomerIds();
    const allCustomerIds = allCustomers.map((c) => c.id);
    const [bulkMetrics, loyaltySnapshots] = await Promise.all([
      this.customerMetricsService.getBulkMetrics(allCustomerIds),
      this.loyaltyService.getAccountSnapshotsForCustomers(allCustomerIds),
    ]);
    const growth = await this.growthFor([segment], allCustomerIds);
    return filterMatchingIds(segment, allCustomerIds, bulkMetrics, loyaltySnapshots, growth);
  }

  // Phase 15: growth fields (RFM / lifecycle / signals) are loaded ONLY when a segment actually uses one — in one bulk aggregate for the whole id set —
  // so every existing segment costs exactly what it did before. Signals (extra queries) only when a condition uses `growthSignal`.
  private async growthFor(segments: SegmentRow[], ids: string[]): Promise<Map<string, SegmentGrowthMetrics> | undefined> {
    const fields = segments.flatMap((s) => s.conditions.map((c) => c.field));
    if (!fields.some(isGrowthField)) return undefined;
    return this.growthService.getSegmentMetrics(ids, { signals: fields.includes('growthSignal') });
  }

  // The explicit allowlist gate (spec: "FIELD -> allowed operators -> value validation"):
  // unknown field -> 400, unknown operator -> 400, field/operator mismatch -> 400, invalid
  // value -> 400. Runs regardless of what the Admin frontend already restricted (never trust
  // frontend validation alone).
  private async validateConditions(
    conditions: { field: string; operator: string; value: string }[],
  ): Promise<PersistedCondition[]> {
    const validated: PersistedCondition[] = [];
    for (const condition of conditions) {
      if (!isSegmentField(condition.field)) {
        throw new BadRequestException(`Unknown segment field "${condition.field}".`);
      }
      if (!isSegmentOperator(condition.operator)) {
        throw new BadRequestException(`Unknown segment operator "${condition.operator}".`);
      }
      const fieldDef = SEGMENT_FIELD_DEFINITIONS[condition.field];
      if (!fieldDef.allowedOperators.includes(condition.operator)) {
        throw new BadRequestException(`Operator "${condition.operator}" is not valid for field "${condition.field}".`);
      }

      if (fieldDef.valueType === 'number') {
        const parsed = Number(condition.value);
        if (condition.value.trim() === '' || !Number.isFinite(parsed)) {
          throw new BadRequestException(`Field "${condition.field}" requires a numeric value.`);
        }
      } else if (fieldDef.valueType === 'date') {
        if (Number.isNaN(new Date(condition.value).getTime())) {
          throw new BadRequestException(`Field "${condition.field}" requires a valid date value.`);
        }
      } else {
        if (condition.value.trim() === '') {
          throw new BadRequestException(`Field "${condition.field}" requires a non-empty value.`);
        }
        if (condition.field === 'lifecycleState' && !(LIFECYCLE_STATES as readonly string[]).includes(condition.value)) {
          throw new BadRequestException(`lifecycleState must be one of: ${LIFECYCLE_STATES.join(', ')}.`);
        }
        if (condition.field === 'growthSignal' && !(SIGNAL_TYPES as readonly string[]).includes(condition.value)) {
          throw new BadRequestException(`growthSignal must be one of: ${SIGNAL_TYPES.join(', ')}.`);
        }
        if (condition.field === 'rfmScore' && !/^[1-5]{3}$/.test(condition.value)) {
          throw new BadRequestException('rfmScore must be three digits 1-5 (recency, frequency, monetary), e.g. "543".');
        }
        if (condition.field === 'favoriteBranch') {
          const branch = await this.branchRepository.findByName(condition.value);
          if (!branch) {
            throw new BadRequestException(`No branch named "${condition.value}" exists.`);
          }
        }
      }

      validated.push({ field: condition.field, operator: condition.operator, value: condition.value });
    }
    return validated;
  }
}

function toSegmentView(row: SegmentRow): SegmentView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    logic: row.logic as 'AND' | 'OR',
    conditions: row.conditions.map((c) => ({
      field: c.field as SegmentField,
      operator: c.operator as SegmentOperator,
      value: c.value,
    })),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Extracted so getMatchingCustomers and getAllMatchingCustomerIds share the exact same
// evaluation path — the segment evaluator is never duplicated. Returns filtered, sorted (for
// deterministic pagination) customer ids.
function filterMatchingIds(
  segment: SegmentRow,
  allCustomerIds: string[],
  bulkMetrics: Awaited<ReturnType<CustomerMetricsService['getBulkMetrics']>>,
  loyaltySnapshots: Awaited<ReturnType<LoyaltyService['getAccountSnapshotsForCustomers']>>,
  growth?: Map<string, SegmentGrowthMetrics>,
): string[] {
  const conditions = segment.conditions.map((c) => ({
    field: c.field as SegmentField,
    operator: c.operator as SegmentOperator,
    value: c.value,
  }));
  const logic = segment.logic as 'AND' | 'OR';
  return allCustomerIds
    .filter((id) => evaluateSegment(logic, conditions, buildEvaluationMetrics(id, bulkMetrics, loyaltySnapshots, growth)))
    .sort();
}

function buildEvaluationMetrics(
  customerId: string,
  bulkMetrics: Awaited<ReturnType<CustomerMetricsService['getBulkMetrics']>>,
  loyaltySnapshots: Awaited<ReturnType<LoyaltyService['getAccountSnapshotsForCustomers']>>,
  growth?: Map<string, SegmentGrowthMetrics>,
): CustomerSegmentMetrics {
  const orderMetrics = bulkMetrics.get(customerId)!;
  const loyalty = loyaltySnapshots.get(customerId) ?? { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 };
  return {
    orderCount: orderMetrics.metrics.orderCount,
    totalSpentMinor: orderMetrics.metrics.totalSpentMinor,
    averageOrderMinor: orderMetrics.metrics.averageOrderMinor,
    firstOrderAt: orderMetrics.metrics.firstOrderAt,
    lastOrderAt: orderMetrics.metrics.lastOrderAt,
    favoriteBranch: orderMetrics.favoriteBranch,
    loyaltyBalance: loyalty.balance,
    loyaltyLifetimeEarned: loyalty.lifetimeEarned,
    loyaltyLifetimeSpent: loyalty.lifetimeSpent,
    ...(growth ? { growth: growth.get(customerId) } : {}),
  };
}
