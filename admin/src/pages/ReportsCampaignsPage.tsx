import { useState } from 'react';
import { formatDate, formatDateTime } from '../lib/format';
import { findNav } from '../lib/nav';
import { ReportsCampaignRow, ReportsCampaignsOverview } from '../lib/reportsTypes';
import { rangeParams, useReport } from '../lib/useReport';
import { Column, DataTable, DateRangePicker, DateRangeValue, EmptyState, FilterBar, isRangeReady, KeyValue, Modal, PageHeader, SectionCard, StatCard, StatGrid } from '../ui';
import { Notes, num, PeriodHint, pctOrDash, ReportBody } from './reportsShared';
import { SortSelect, SortState } from './reportsProductShared';

type SortKey = 'lastActivity' | 'recipients' | 'successfulSends' | 'failedSends';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'lastActivity', label: 'Last activity' },
  { key: 'recipients', label: 'Recipients' },
  { key: 'successfulSends', label: 'Successful sends' },
  { key: 'failedSends', label: 'Failed sends' },
];

const columns: Column<ReportsCampaignRow>[] = [
  { key: 'n', header: 'Campaign', cell: (c) => <span className="font-semibold text-black">{c.name}</span> },
  { key: 's', header: 'Status (now)', cell: (c) => c.status },
  { key: 'r', header: 'Recipients', numeric: true, cell: (c) => num(c.totalRecipients) },
  { key: 'ok', header: 'Successful sends', numeric: true, cell: (c) => num(c.successfulSends) },
  { key: 'f', header: 'Failed sends', numeric: true, cell: (c) => num(c.failedSends) },
  { key: 'rate', header: 'Send success rate', numeric: true, low: true, cell: (c) => pctOrDash(c.sendSuccessRatePercent) },
  { key: 'conv', header: 'Converted', numeric: true, low: true, cell: () => '—' },
  { key: 'rev', header: 'Attributed revenue', numeric: true, low: true, cell: () => '—' },
  { key: 'l', header: 'Last activity', low: true, cell: (c) => (c.lastActivityAt ? formatDate(c.lastActivityAt) : '—') },
];

// Campaigns — send activity as the campaign engine recorded it. "Successful send" = Telegram accepted the message (no
// delivery receipts exist). Conversion and revenue are not attributable in the current schema and are shown as "—".
export function ReportsCampaignsPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last30', startDate: '', endDate: '' });
  const [sort, setSort] = useState<SortState<SortKey>>({ by: 'lastActivity', direction: 'desc' });
  const [selected, setSelected] = useState<ReportsCampaignRow | null>(null);
  const ready = isRangeReady(range);
  const { item } = findNav('reports-campaigns');
  const { data, error, loading, reload } = useReport<ReportsCampaignsOverview>('campaigns', { ...rangeParams(range), sortBy: sort.by, sortDirection: sort.direction }, ready);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <SortSelect onChange={setSort} options={SORT_OPTIONS} value={sort} />
        <PeriodHint loading={loading} period={data?.period} />
      </FilterBar>

      <ReportBody data={data} error={error} loading={loading} ready={ready} reload={reload} title="Campaigns could not be loaded">
        {(d) => (
          <>
            <StatGrid>
              <StatCard hint="All time" label="Total campaigns" value={num(d.summary.totalCampaigns)} />
              <StatCard hint="Status 'sending' now" label="Active campaigns" value={num(d.summary.activeCampaigns)} />
              <StatCard hint="With sends or failures in period" label="Campaigns with activity" value={num(d.summary.campaignsWithActivity)} />
              <StatCard label="Successful sends" strong value={num(d.summary.successfulSends)} />
              <StatCard label="Failed sends" value={num(d.summary.failedSends)} />
              <StatCard hint="Successful ÷ attempted" label="Send success rate" value={pctOrDash(d.summary.sendSuccessRatePercent)} />
              <StatCard label="Customers reached" value={num(d.summary.uniqueCustomersReached)} />
              <StatCard hint="Not currently attributable" label="Converted customers" value="—" />
            </StatGrid>

            <SectionCard description="Sends and failures in the selected period; recipients and status are the campaign's current totals. Click a campaign for details." flush title="Campaign activity">
              <DataTable columns={columns} empty={<EmptyState text="No campaigns exist yet." title="No campaigns" variant="inline" />} onRowClick={setSelected} rowKey={(c) => c.campaignId} rows={d.campaigns} />
            </SectionCard>

            <SectionCard description="The latest 20 recorded sends and failures in the period." flush title="Recent campaign activity">
              <RecentActivity rows={d.recentActivity} />
            </SectionCard>

            <Notes notes={d.notes} />
          </>
        )}
      </ReportBody>

      {selected && <CampaignDetail campaign={selected} onClose={() => setSelected(null)} range={range} />}
    </>
  );
}

function RecentActivity({ rows }: { rows: ReportsCampaignsOverview['recentActivity'] }) {
  return (
    <DataTable
      columns={[
        { key: 'd', header: 'Date', cell: (r) => formatDateTime(r.at) },
        { key: 'c', header: 'Campaign', cell: (r) => <span className="font-semibold text-black">{r.campaignName}</span> },
        { key: 'u', header: 'Customer', cell: (r) => r.customerName ?? '—' },
        { key: 's', header: 'Status', cell: (r) => (r.status === 'sent' ? 'Sent' : 'Failed') },
        { key: 'e', header: 'Failure code', low: true, cell: (r) => r.errorCode ?? '—' },
      ]}
      empty={<EmptyState text="No campaign messages were sent or failed in this period." title="No activity" variant="inline" />}
      rowKey={(r) => `${r.recipientId}-${r.status}`}
      rows={rows}
    />
  );
}

// Read-only detail: this campaign's figures plus its own recent activity (campaignId filter). No send/edit actions.
function CampaignDetail({ campaign, range, onClose }: { campaign: ReportsCampaignRow; range: DateRangeValue; onClose: () => void }) {
  const { data } = useReport<ReportsCampaignsOverview>('campaigns', { ...rangeParams(range), campaignId: campaign.campaignId }, true);
  return (
    <Modal onClose={onClose} title={campaign.name} wide>
      <KeyValue
        rows={[
          { key: 's', label: 'Status (now)', value: campaign.status },
          { key: 'ch', label: 'Channel', value: campaign.channel },
          { key: 'c', label: 'Created', value: formatDateTime(campaign.createdAt) },
          { key: 'r', label: 'Recipients (total)', value: num(campaign.totalRecipients) },
          { key: 'a', label: 'Recipients added in period', value: num(campaign.recipientsAdded) },
          { key: 'ok', label: 'Successful sends in period', value: num(campaign.successfulSends) },
          { key: 'f', label: 'Failed sends in period', value: num(campaign.failedSends) },
          { key: 'p', label: 'Pending or uncertain (now)', value: num(campaign.pendingOrUncertain) },
          { key: 'sk', label: 'Skipped (now)', value: num(campaign.skipped) },
          { key: 'cv', label: 'Conversion / attributed revenue', value: 'Not currently attributable' },
        ]}
      />
      <h3 className="mt-4 mb-2 mx-0">Recent activity</h3>
      {data ? <RecentActivity rows={data.recentActivity} /> : <p className="text-[13px] leading-snug text-muted">Loading…</p>}
    </Modal>
  );
}
