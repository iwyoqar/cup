import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '../../common/config/config.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { buildSearchWhere } from '../admin-customers/admin-customers.repository';
import { AnalyticsRepository } from '../analytics/analytics.repository';
import { AnalyticsPeriod, resolveAnalyticsRange } from '../analytics/analytics-period';
import { CUSTOMER_METRICS_ORDER_STATUSES } from '../customer-metrics/customer-metrics-order-statuses';

export type ReceiptSource = 'CUP' | 'POS';

export interface ReceiptsReportQuery {
  period: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  branchId?: string;
  source: 'all' | 'cup' | 'pos';
  status: 'all' | 'paid' | 'unpaid';
  search?: string;
  customerId?: string;
  cursor?: string;
  limit: number; // <= 100, enforced by the controller schema
}

export interface ReportsReceiptRow {
  source: ReceiptSource;
  receiptId: string; // CUP: Order.id; POS: posterTransactionId — never invented
  cupOrderId: string | null;
  posterTransactionId: string | null; // POS: its own id; CUP: via PosterIncomingOrderLink when Poster reported one
  customerId: string | null;
  customerName: string | null;
  branchId: string | null;
  branchName: string | null; // null = unattributed
  occurredAt: string;
  items: number; // total quantity on the receipt (every line)
  totalMinor: number;
  paidMinor: number | null; // POS only — CUP orders store no payment data
  status: string; // CUP Order.status as stored; POS: "Closed" for Poster status 2 (the only status the import accepts)
  paymentMethod: string | null; // POS pay_type label; null when unknown
}

export interface ReportsReceiptsOverview {
  period: { key: AnalyticsPeriod; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  branch: { id: string; name: string } | null;
  filters: { branches: { id: string; name: string }[] };
  summary: {
    receipts: number;
    revenueMinor: number; // sum of the receipt totals in the filtered population
    paidMinor: number; // POS paidMinor only
    unpaidReceipts: number; // POS receipts Poster closed without payment (pay_type 0)
    identifiedCustomers: number;
    anonymousPosReceipts: number;
    cupReceipts: number;
    posReceipts: number;
  };
  reconciliation: { analyticsRevenueMinor: number; receiptsRevenueMinor: number; comparable: boolean } ;
  rows: ReportsReceiptRow[];
  page: { limit: number; nextCursor: string | null; total: number };
  notes: string[];
}

export interface ReportsReceiptDetail extends ReportsReceiptRow {
  lines: { product: string; posterProductId: string; mapped: boolean; quantity: number; unitPriceMinor: number; totalMinor: number; isRewardItem: boolean }[];
}

const CUP_STATUSES = [...CUSTOMER_METRICS_ORDER_STATUSES];
// Documented Poster pay_type (poster.types.ts): 0 closed without payment, 1 cash, 2 card, 3 mixed.
const PAY_TYPE: Record<string, string> = { '0': 'Closed without payment', '1': 'Cash', '2': 'Card', '3': 'Mixed' };
const PAID_TYPES = ['1', '2', '3'];
const posStatusLabel = (s: string) => (s === '2' ? 'Closed' : `Poster status ${s}`);

interface Cursor {
  t: number;
  s: ReceiptSource;
  id: string;
}
const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (typeof c.t === 'number' && (c.s === 'CUP' || c.s === 'POS') && typeof c.id === 'string') return c;
  } catch {
    // fall through
  }
  throw new BadRequestException('Invalid cursor.');
}

// Reports Phase H — Receipts. One row per qualifying receipt, read from CUP's own normalized records — exactly the
// population Analytics counts: CUP Orders in CUSTOMER_METRICS_ORDER_STATUSES (Order.branchId) and IMPORTED
// PosterImportedTransactions (their stored branchId). CUP-originated Poster receipts are never imported as POS rows (the
// POS import's PosterIncomingOrderLink / unique posterTransactionId rules), so nothing appears twice; no new dedup logic.
// Refund-/reversal-shaped Poster receipts are rejected by the POS import and therefore never appear here.
// Ordering: time desc, then POS before CUP at the same instant, then id desc — a keyset cursor over that order keeps deep
// pages cheap and stable. Never calls Poster.
@Injectable()
export class ReportsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analyticsRepository: AnalyticsRepository,
    private readonly config: ConfigService,
  ) {}

  async getReceipts(query: ReceiptsReportQuery, now: Date = new Date()): Promise<ReportsReceiptsOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveAnalyticsRange(query, now, offset);
    const [branches, branch] = await Promise.all([
      this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      query.branchId ? this.prisma.branch.findUnique({ where: { id: query.branchId }, select: { id: true, name: true } }) : Promise.resolve(null),
    ]);
    if (query.branchId && !branch) throw new BadRequestException('Unknown branch.');
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    // Payment status is only known for POS receipts, so a paid/unpaid filter leaves CUP orders out (never guessed as paid).
    const includeCup = query.source !== 'pos' && query.status === 'all';
    const includePos = query.source !== 'cup';
    // Sub-filters below are combined with AND (never object spread), so they can never override a user filter.
    const { cupWhere, posWhere } = await this.baseWhere(query, range.from, range.to);

    const none = Promise.resolve(null);
    const [cupAgg, cupCustomers, posAgg, posCustomers, posUnpaid, posAnonymous, cupPage, posPage, cupTotals, posTotals] = await Promise.all([
      includeCup ? this.prisma.order.aggregate({ where: cupWhere, _count: { _all: true }, _sum: { totalMinor: true } }) : none,
      includeCup ? this.prisma.order.groupBy({ by: ['customerId'], where: cupWhere }) : Promise.resolve([] as { customerId: string }[]),
      includePos ? this.prisma.posterImportedTransaction.aggregate({ where: posWhere, _count: { _all: true }, _sum: { totalMinor: true, paidMinor: true } }) : none,
      includePos ? this.prisma.posterImportedTransaction.groupBy({ by: ['customerId'], where: { AND: [posWhere, { customerId: { not: null } }] } }) : Promise.resolve([] as { customerId: string | null }[]),
      includePos ? this.prisma.posterImportedTransaction.count({ where: { AND: [posWhere, { posterPayType: '0' }] } }) : Promise.resolve(0),
      includePos ? this.prisma.posterImportedTransaction.count({ where: { AND: [posWhere, { customerId: null }] } }) : Promise.resolve(0),
      includeCup ? this.cupPage(cupWhere, cursor, query.limit + 1) : Promise.resolve([]),
      includePos ? this.posPage(posWhere, cursor, query.limit + 1) : Promise.resolve([]),
      // Analytics' own totals for the same period/branch/source — reconciliation reference only.
      query.source !== 'pos' ? this.analyticsRepository.cupTotals({ from: range.from, to: range.to, branchId: branch?.id ?? null }) : Promise.resolve({ count: 0, revenue: 0 }),
      query.source !== 'cup' ? this.analyticsRepository.posTotals({ from: range.from, to: range.to, branchId: branch?.id ?? null }) : Promise.resolve({ count: 0, revenue: 0 }),
    ]);

    const merged = [...cupPage, ...posPage].sort(compareRows);
    const pageRows = merged.slice(0, query.limit);
    const hasMore = merged.length > query.limit;
    const rows = await this.hydrate(pageRows);

    const cupCount = cupAgg?._count._all ?? 0;
    const posCount = posAgg?._count._all ?? 0;
    const receiptsRevenue = (cupAgg?._sum.totalMinor ?? 0) + (posAgg?._sum.totalMinor ?? 0);
    const identified = new Set<string>([...cupCustomers.map((c) => c.customerId), ...posCustomers.map((c) => c.customerId as string)]);
    const comparable = !query.search?.trim() && !query.customerId && query.status === 'all';

    const notes = [
      'Receipts are the same qualifying records Analytics counts: CUP orders in a confirmed status and imported Poster POS receipts. CUP-originated Poster receipts are never imported twice.',
      'Paid amount and payment method are only known for POS receipts; CUP orders store no payment data and show "—".',
      'Refund-shaped Poster receipts are excluded by the POS import and never appear here.',
    ];
    if (query.status !== 'all') notes.push('The paid/unpaid filter applies to POS receipts only, so CUP orders are not included while it is set.');

    const last = pageRows[pageRows.length - 1];
    return {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate, timezoneOffsetMinutes: offset },
      branch,
      filters: { branches },
      summary: {
        receipts: cupCount + posCount,
        revenueMinor: receiptsRevenue,
        paidMinor: posAgg?._sum.paidMinor ?? 0,
        unpaidReceipts: posUnpaid,
        identifiedCustomers: identified.size,
        anonymousPosReceipts: posAnonymous,
        cupReceipts: cupCount,
        posReceipts: posCount,
      },
      reconciliation: { analyticsRevenueMinor: cupTotals.revenue + posTotals.revenue, receiptsRevenueMinor: receiptsRevenue, comparable },
      rows,
      page: { limit: query.limit, nextCursor: hasMore && last ? encodeCursor({ t: last.t, s: last.source, id: last.id }) : null, total: cupCount + posCount },
      notes,
    };
  }

  async getReceipt(source: ReceiptSource, receiptId: string): Promise<ReportsReceiptDetail> {
    if (source === 'CUP') {
      const o = await this.prisma.order.findFirst({
        where: { id: receiptId, status: { in: CUP_STATUSES } },
        select: {
          id: true, createdAt: true, status: true, totalMinor: true, branchId: true, customerId: true, posterIncomingOrderId: true,
          customer: { select: { displayName: true } }, branch: { select: { name: true } },
          items: { select: { posterProductId: true, quantity: true, unitPriceMinor: true, totalPriceMinor: true, isRewardItem: true, product: { select: { name: true } } }, orderBy: { id: 'asc' } },
        },
      });
      if (!o) throw new NotFoundException('Receipt not found.');
      const link = o.posterIncomingOrderId ? await this.prisma.posterIncomingOrderLink.findUnique({ where: { posterIncomingOrderId: o.posterIncomingOrderId }, select: { posterTransactionId: true } }) : null;
      return {
        ...this.cupRow(o, o.items.reduce((s, i) => s + i.quantity, 0), link?.posterTransactionId ?? null),
        lines: o.items.map((i) => ({ product: i.product.name, posterProductId: i.posterProductId, mapped: true, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, totalMinor: i.totalPriceMinor, isRewardItem: i.isRewardItem })),
      };
    }
    const t = await this.prisma.posterImportedTransaction.findFirst({
      where: { posterTransactionId: receiptId, status: 'IMPORTED' },
      select: {
        id: true, posterTransactionId: true, occurredAt: true, posterStatus: true, posterPayType: true, totalMinor: true, paidMinor: true, branchId: true, customerId: true,
        customer: { select: { displayName: true } }, branch: { select: { name: true } },
        items: { select: { posterProductId: true, quantity: true, posterProductPriceMinor: true, posterPayedSumMinor: true, product: { select: { name: true } } }, orderBy: { lineIndex: 'asc' } },
      },
    });
    if (!t) throw new NotFoundException('Receipt not found.');
    return {
      ...this.posRow(t, t.items.reduce((s, i) => s + i.quantity, 0)),
      lines: t.items.map((i) => ({ product: i.product?.name ?? `Unmapped Product (Poster #${i.posterProductId})`, posterProductId: i.posterProductId, mapped: !!i.product, quantity: i.quantity, unitPriceMinor: i.posterProductPriceMinor, totalMinor: i.posterPayedSumMinor, isRewardItem: false })),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------

  private async baseWhere(query: ReceiptsReportQuery, from: Date, to: Date) {
    const search = query.search?.trim();
    let cupSearch: Prisma.OrderWhereInput = {};
    let posSearch: Prisma.PosterImportedTransactionWhereInput = {};
    if (search) {
      // A CUP order's Poster transaction id lives in PosterIncomingOrderLink (keyed by incoming order id).
      const links = await this.prisma.posterIncomingOrderLink.findMany({ where: { posterTransactionId: { contains: search } }, select: { posterIncomingOrderId: true }, take: 200 });
      const customer = buildSearchWhere(search);
      cupSearch = { OR: [{ id: { contains: search } }, ...(links.length ? [{ posterIncomingOrderId: { in: links.map((l) => l.posterIncomingOrderId) } }] : []), { customer }] };
      posSearch = { OR: [{ posterTransactionId: { contains: search } }, { customer }] };
    }
    const cupWhere: Prisma.OrderWhereInput = {
      status: { in: CUP_STATUSES },
      createdAt: { gte: from, lt: to },
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...cupSearch,
    };
    const posWhere: Prisma.PosterImportedTransactionWhereInput = {
      status: 'IMPORTED',
      occurredAt: { gte: from, lt: to },
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status === 'paid' ? { posterPayType: { in: PAID_TYPES } } : query.status === 'unpaid' ? { posterPayType: '0' } : {}),
      ...posSearch,
    };
    return { cupWhere, posWhere };
  }

  // Keyset page: rows strictly after the cursor in (time desc, POS before CUP, id desc) order. Narrow selects, one query.
  private async cupPage(where: Prisma.OrderWhereInput, c: Cursor | null, take: number) {
    const after: Prisma.OrderWhereInput = c
      ? { OR: [{ createdAt: { lt: new Date(c.t) } }, { createdAt: new Date(c.t), ...(c.s === 'CUP' ? { id: { lt: c.id } } : {}) }] }
      : {};
    const rows = await this.prisma.order.findMany({
      where: { AND: [where, after] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: { id: true, createdAt: true, status: true, totalMinor: true, branchId: true, customerId: true, posterIncomingOrderId: true, customer: { select: { displayName: true } }, branch: { select: { name: true } } },
    });
    return rows.map((r) => ({ source: 'CUP' as const, id: r.id, t: r.createdAt.getTime(), cup: r }));
  }

  private async posPage(where: Prisma.PosterImportedTransactionWhereInput, c: Cursor | null, take: number) {
    const after: Prisma.PosterImportedTransactionWhereInput = c
      ? { OR: [{ occurredAt: { lt: new Date(c.t) } }, ...(c.s === 'POS' ? [{ occurredAt: new Date(c.t), id: { lt: c.id } }] : [])] }
      : {};
    const rows = await this.prisma.posterImportedTransaction.findMany({
      where: { AND: [where, after] },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take,
      select: { id: true, posterTransactionId: true, occurredAt: true, posterStatus: true, posterPayType: true, totalMinor: true, paidMinor: true, branchId: true, customerId: true, customer: { select: { displayName: true } }, branch: { select: { name: true } } },
    });
    return rows.map((r) => ({ source: 'POS' as const, id: r.id, t: r.occurredAt.getTime(), pos: r }));
  }

  // Item quantities and CUP -> Poster transaction ids for ONE page: three grouped/bulk queries, never per row.
  private async hydrate(page: PageRow[]): Promise<ReportsReceiptRow[]> {
    const cupIds = page.filter((r) => r.source === 'CUP').map((r) => r.id);
    const posIds = page.filter((r) => r.source === 'POS').map((r) => r.id);
    const incomingIds = page.flatMap((r) => (r.source === 'CUP' && r.cup.posterIncomingOrderId ? [r.cup.posterIncomingOrderId] : []));
    const [cupQty, posQty, links] = await Promise.all([
      cupIds.length ? this.prisma.orderItem.groupBy({ by: ['orderId'], where: { orderId: { in: cupIds } }, _sum: { quantity: true } }) : Promise.resolve([]),
      posIds.length ? this.prisma.posterImportedTransactionItem.groupBy({ by: ['transactionId'], where: { transactionId: { in: posIds } }, _sum: { quantity: true } }) : Promise.resolve([]),
      incomingIds.length ? this.prisma.posterIncomingOrderLink.findMany({ where: { posterIncomingOrderId: { in: incomingIds } }, select: { posterIncomingOrderId: true, posterTransactionId: true } }) : Promise.resolve([]),
    ]);
    const cupQ = new Map(cupQty.map((q) => [q.orderId, q._sum.quantity ?? 0]));
    const posQ = new Map(posQty.map((q) => [q.transactionId, q._sum.quantity ?? 0]));
    const linkOf = new Map(links.map((l) => [l.posterIncomingOrderId, l.posterTransactionId]));
    return page.map((r) =>
      r.source === 'CUP'
        ? this.cupRow(r.cup, cupQ.get(r.id) ?? 0, r.cup.posterIncomingOrderId ? linkOf.get(r.cup.posterIncomingOrderId) ?? null : null)
        : this.posRow(r.pos, posQ.get(r.id) ?? 0),
    );
  }

  private cupRow(o: CupSel, items: number, posterTransactionId: string | null): ReportsReceiptRow {
    return {
      source: 'CUP', receiptId: o.id, cupOrderId: o.id, posterTransactionId, customerId: o.customerId, customerName: o.customer.displayName,
      branchId: o.branchId, branchName: o.branch?.name ?? null, occurredAt: o.createdAt.toISOString(), items, totalMinor: o.totalMinor, paidMinor: null, status: o.status, paymentMethod: null,
    };
  }

  private posRow(t: PosSel, items: number): ReportsReceiptRow {
    return {
      source: 'POS', receiptId: t.posterTransactionId, cupOrderId: null, posterTransactionId: t.posterTransactionId, customerId: t.customerId, customerName: t.customer?.displayName ?? null,
      branchId: t.branchId, branchName: t.branch?.name ?? null, occurredAt: t.occurredAt.toISOString(), items, totalMinor: t.totalMinor, paidMinor: t.paidMinor,
      status: posStatusLabel(t.posterStatus), paymentMethod: PAY_TYPE[t.posterPayType] ?? null,
    };
  }
}

type CupSel = { id: string; createdAt: Date; status: string; totalMinor: number; branchId: string | null; customerId: string; posterIncomingOrderId: string | null; customer: { displayName: string | null }; branch: { name: string } | null };
type PosSel = { id: string; posterTransactionId: string; occurredAt: Date; posterStatus: string; posterPayType: string; totalMinor: number; paidMinor: number; branchId: string; customerId: string | null; customer: { displayName: string | null } | null; branch: { name: string } | null };
type PageRow = { source: 'CUP'; id: string; t: number; cup: CupSel } | { source: 'POS'; id: string; t: number; pos: PosSel };

function compareRows(a: PageRow, b: PageRow): number {
  if (a.t !== b.t) return b.t - a.t;
  if (a.source !== b.source) return a.source === 'POS' ? -1 : 1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}
