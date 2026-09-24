import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AnalyticsPeriod, resolveAnalyticsRange } from '../analytics/analytics-period';

export type CampaignSortBy = 'recipients' | 'successfulSends' | 'failedSends' | 'lastActivity';

export interface CampaignsReportQuery {
  period: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  campaignId?: string;
  sortBy: CampaignSortBy;
  sortDirection: 'asc' | 'desc';
}

export interface ReportsCampaignRow {
  campaignId: string;
  name: string;
  channel: string;
  status: string; // Campaign.status as persisted: draft | sending | completed | failed (current state)
  createdAt: string;
  // Period-scoped (recipient event timestamps):
  recipientsAdded: number; // CampaignRecipient rows created in the period (audience frozen)
  successfulSends: number; // status 'sent' with sentAt in the period
  failedSends: number; // status 'failed' with failedAt in the period
  sendSuccessRatePercent: number | null; // sent / (sent + failed); null with no attempts
  // Current state, all-time for this campaign:
  totalRecipients: number;
  pendingOrUncertain: number; // 'pending' also covers an attempt whose outcome is unknown (see campaign-recipient-status.ts)
  skipped: number;
  lastActivityAt: string | null; // latest sentAt / failedAt in the period
  convertedCustomers: null; // not attributable — see notes
  attributedRevenueMinor: null;
}

export interface ReportsCampaignActivity {
  recipientId: string;
  at: string;
  campaignId: string;
  campaignName: string;
  customerId: string;
  customerName: string | null;
  status: 'sent' | 'failed';
  errorCode: string | null; // the stored error code only — never message text or Telegram ids
}

export interface ReportsCampaignsOverview {
  period: { key: AnalyticsPeriod; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  filters: { campaigns: { id: string; name: string }[] };
  summary: {
    totalCampaigns: number;
    activeCampaigns: number; // status 'sending' right now
    campaignsWithActivity: number; // campaigns with a send or failure in the period
    recipientsAdded: number;
    successfulSends: number;
    failedSends: number;
    sendSuccessRatePercent: number | null;
    uniqueCustomersReached: number; // distinct customers with a successful send in the period
  };
  campaigns: ReportsCampaignRow[];
  recentActivity: ReportsCampaignActivity[];
  conversionAttributable: false;
  branchFilterSupported: false;
  notes: string[];
}

const RECENT_LIMIT = 20;
const rate = (ok: number, failed: number) => (ok + failed > 0 ? Math.round((ok * 1000) / (ok + failed)) / 10 : null);

// Reports Phase F3 — Campaigns. Read-only over Campaign + CampaignRecipient exactly as the campaign engine persists them
// (recipient status pending | sent | failed | skipped; sentAt / failedAt). "sent" means Telegram accepted the send call —
// CUP records no delivery/read receipt, so nothing is called "delivered". There is no campaign -> order/promotion link in
// the schema, so conversion and revenue are NOT attributed (never "orders after the send date"). Campaign recipients have
// no branch, so the report is all-branch. Never sends, never creates a recipient.
@Injectable()
export class ReportsCampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getCampaigns(query: CampaignsReportQuery, now: Date = new Date()): Promise<ReportsCampaignsOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveAnalyticsRange(query, now, offset);
    const inRange = { gte: range.from, lt: range.to };

    const campaigns = await this.prisma.campaign.findMany({ select: { id: true, name: true, channel: true, status: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
    if (query.campaignId && !campaigns.some((c) => c.id === query.campaignId)) throw new BadRequestException('Unknown campaign.');
    const scope = query.campaignId ? { campaignId: query.campaignId } : {};

    const [added, sent, failed, byStatus, reached, recentSent, recentFailed] = await Promise.all([
      this.prisma.campaignRecipient.groupBy({ by: ['campaignId'], where: { ...scope, createdAt: inRange }, _count: { _all: true } }),
      this.prisma.campaignRecipient.groupBy({ by: ['campaignId'], where: { ...scope, status: 'sent', sentAt: inRange }, _count: { _all: true }, _max: { sentAt: true } }),
      this.prisma.campaignRecipient.groupBy({ by: ['campaignId'], where: { ...scope, status: 'failed', failedAt: inRange }, _count: { _all: true }, _max: { failedAt: true } }),
      this.prisma.campaignRecipient.groupBy({ by: ['campaignId', 'status'], where: scope, _count: { _all: true } }),
      this.prisma.campaignRecipient.groupBy({ by: ['customerId'], where: { ...scope, status: 'sent', sentAt: inRange } }),
      this.prisma.campaignRecipient.findMany({ where: { ...scope, status: 'sent', sentAt: inRange }, orderBy: [{ sentAt: 'desc' }, { id: 'asc' }], take: RECENT_LIMIT, select: { id: true, sentAt: true, campaignId: true, customerId: true, customer: { select: { displayName: true } } } }),
      this.prisma.campaignRecipient.findMany({ where: { ...scope, status: 'failed', failedAt: inRange }, orderBy: [{ failedAt: 'desc' }, { id: 'asc' }], take: RECENT_LIMIT, select: { id: true, failedAt: true, campaignId: true, customerId: true, errorCode: true, customer: { select: { displayName: true } } } }),
    ]);

    const addedBy = new Map(added.map((r) => [r.campaignId, r._count._all]));
    const sentBy = new Map(sent.map((r) => [r.campaignId, r]));
    const failedBy = new Map(failed.map((r) => [r.campaignId, r]));
    const statusCount = (id: string, s: string) => byStatus.find((r) => r.campaignId === id && r.status === s)?._count._all ?? 0;
    const names = new Map(campaigns.map((c) => [c.id, c.name]));

    const rows: ReportsCampaignRow[] = (query.campaignId ? campaigns.filter((c) => c.id === query.campaignId) : campaigns).map((c) => {
      const ok = sentBy.get(c.id)?._count._all ?? 0;
      const bad = failedBy.get(c.id)?._count._all ?? 0;
      const lastMs = Math.max(sentBy.get(c.id)?._max.sentAt?.getTime() ?? -Infinity, failedBy.get(c.id)?._max.failedAt?.getTime() ?? -Infinity);
      return {
        campaignId: c.id,
        name: c.name,
        channel: c.channel,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        recipientsAdded: addedBy.get(c.id) ?? 0,
        successfulSends: ok,
        failedSends: bad,
        sendSuccessRatePercent: rate(ok, bad),
        totalRecipients: byStatus.filter((r) => r.campaignId === c.id).reduce((s, r) => s + r._count._all, 0),
        pendingOrUncertain: statusCount(c.id, 'pending'),
        skipped: statusCount(c.id, 'skipped'),
        lastActivityAt: Number.isFinite(lastMs) ? new Date(lastMs).toISOString() : null,
        convertedCustomers: null,
        attributedRevenueMinor: null,
      };
    });

    const recentActivity: ReportsCampaignActivity[] = [
      ...recentSent.map((r) => ({ recipientId: r.id, at: r.sentAt!.toISOString(), campaignId: r.campaignId, campaignName: names.get(r.campaignId) ?? r.campaignId, customerId: r.customerId, customerName: r.customer.displayName, status: 'sent' as const, errorCode: null })),
      ...recentFailed.map((r) => ({ recipientId: r.id, at: r.failedAt!.toISOString(), campaignId: r.campaignId, campaignName: names.get(r.campaignId) ?? r.campaignId, customerId: r.customerId, customerName: r.customer.displayName, status: 'failed' as const, errorCode: r.errorCode })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at) || a.recipientId.localeCompare(b.recipientId))
      .slice(0, RECENT_LIMIT);

    const totalOk = sent.reduce((s, r) => s + r._count._all, 0);
    const totalBad = failed.reduce((s, r) => s + r._count._all, 0);
    return {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate, timezoneOffsetMinutes: offset },
      filters: { campaigns: campaigns.map((c) => ({ id: c.id, name: c.name })) },
      summary: {
        totalCampaigns: campaigns.length,
        activeCampaigns: campaigns.filter((c) => c.status === 'sending').length,
        campaignsWithActivity: new Set([...sent.map((r) => r.campaignId), ...failed.map((r) => r.campaignId)]).size,
        recipientsAdded: added.reduce((s, r) => s + r._count._all, 0),
        successfulSends: totalOk,
        failedSends: totalBad,
        sendSuccessRatePercent: rate(totalOk, totalBad),
        uniqueCustomersReached: reached.length,
      },
      campaigns: sortCampaigns(rows, query.sortBy, query.sortDirection),
      recentActivity,
      conversionAttributable: false,
      branchFilterSupported: false,
      notes: [
        '"Successful send" means Telegram accepted the message; CUP does not record delivery or read receipts.',
        '"Pending" also includes sends whose outcome is uncertain (e.g. a timeout) — the campaign engine never guesses those.',
        'Campaign conversion and revenue are not currently attributable: nothing links a campaign message to an order or a promotion redemption.',
        'Campaign recipients have no branch, so this report always covers all branches. CRM automation messages are not campaigns and are not included.',
      ],
    };
  }
}

function sortCampaigns(rows: ReportsCampaignRow[], by: CampaignSortBy, direction: 'asc' | 'desc'): ReportsCampaignRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  const value = (r: ReportsCampaignRow) =>
    by === 'recipients' ? r.totalRecipients : by === 'successfulSends' ? r.successfulSends : by === 'failedSends' ? r.failedSends : r.lastActivityAt ? Date.parse(r.lastActivityAt) : -Infinity;
  return [...rows].sort((a, b) => {
    const d = (value(a) - value(b)) * sign;
    return (Number.isNaN(d) ? 0 : d) || (a.campaignId < b.campaignId ? -1 : a.campaignId > b.campaignId ? 1 : 0);
  });
}
