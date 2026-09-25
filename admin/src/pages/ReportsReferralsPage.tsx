import { useEffect, useState } from 'react';
import { formatDate, formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { ReportsReferralsOverview } from '../lib/reportsTypes';
import { rangeParams, useReport } from '../lib/useReport';
import { Column, DataTable, DateRangePicker, DateRangeValue, EmptyState, FilterBar, HBarList, isRangeReady, PageHeader, Pagination, SectionCard, StatCard, StatGrid } from '../ui';
import { Notes, num, PeriodHint, ReportBody } from './reportsShared';
import { SortSelect, SortState } from './reportsProductShared';

type SortKey = 'qualified' | 'referrals' | 'rewards' | 'qualifyingAmount';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'qualified', label: 'Qualified' },
  { key: 'referrals', label: 'Referrals created' },
  { key: 'rewards', label: 'Rewards granted' },
  { key: 'qualifyingAmount', label: 'Qualifying amount' },
];
const STAGE_LABEL = { CREATED: 'Created', REGISTERED: 'Registered', QUALIFIED: 'Qualified', REWARDED: 'Rewarded', CLOSED: 'Closed without qualifying' } as const;

type Referrer = ReportsReferralsOverview['referrers'][number];
type Referred = ReportsReferralsOverview['referred'][number];

const referrerColumns: Column<Referrer>[] = [
  { key: 'n', header: 'Referrer', cell: (r) => <span className="font-semibold text-black">{r.name ?? '—'}</span> },
  { key: 'code', header: 'Code', low: true, cell: (r) => r.code ?? '—' },
  { key: 'c', header: 'Created', numeric: true, cell: (r) => num(r.referralsCreated) },
  { key: 'q', header: 'Qualified', numeric: true, cell: (r) => num(r.qualified) },
  { key: 'rw', header: 'Rewards', numeric: true, cell: (r) => num(r.rewardsGranted) },
  { key: 'cu', header: 'Customers', numeric: true, low: true, cell: (r) => num(r.referredCustomers) },
  { key: 'amt', header: 'Qualifying amount', numeric: true, low: true, cell: (r) => formatSom(r.qualifyingAmountMinor) },
];

const referredColumns: Column<Referred>[] = [
  { key: 'n', header: 'Referred customer', cell: (r) => <span className="font-semibold text-black">{r.referredName ?? '—'}</span> },
  { key: 'by', header: 'Referrer', cell: (r) => r.referrerName ?? '—' },
  { key: 'd', header: 'Date', low: true, cell: (r) => formatDate(r.createdAt) },
  { key: 's', header: 'Status (now)', cell: (r) => r.status + (r.closeReason ? ` · ${r.closeReason}` : '') },
  { key: 'rw', header: 'Reward', low: true, cell: (r) => (r.referredReward ? `${r.referredReward.status} · ${num(r.referredReward.points)} pts` : '—') },
  { key: 'a', header: 'Qualifying amount', numeric: true, low: true, cell: (r) => (r.qualifyingAmountMinor === null ? '—' : formatSom(r.qualifyingAmountMinor)) },
];

// Referrals — the referral engine's recorded results only (status, qualification, rewards). Funnel stages count events
// in the period. "Qualifying amount" is the one purchase that qualified a referral, never lifetime spend.
export function ReportsReferralsPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last30', startDate: '', endDate: '' });
  const [sort, setSort] = useState<SortState<SortKey>>({ by: 'qualified', direction: 'desc' });
  const [page, setPage] = useState(1);
  const ready = isRangeReady(range);
  const { item } = findNav('reports-referrals');
  useEffect(() => setPage(1), [range, sort]);
  const { data, error, loading, reload } = useReport<ReportsReferralsOverview>('referrals', { ...rangeParams(range), sortBy: sort.by, sortDirection: sort.direction, page, limit: 50 }, ready);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <SortSelect onChange={setSort} options={SORT_OPTIONS} value={sort} />
        <PeriodHint loading={loading} period={data?.period} />
      </FilterBar>

      <ReportBody data={data} error={error} loading={loading} ready={ready} reload={reload} title="Referrals could not be loaded">
        {(d) => (
          <>
            <StatGrid>
              <StatCard hint="All time, current state" label="Referral codes" value={num(d.summary.referralCodes)} />
              <StatCard label="Referrals created" value={num(d.summary.referralsCreated)} />
              <StatCard label="Qualified referrals" strong value={num(d.summary.qualifiedReferrals)} />
              <StatCard hint={`${num(d.summary.rewardPointsGranted)} pts`} label="Rewards granted" value={num(d.summary.rewardsGranted)} />
              <StatCard label="Referrers" value={num(d.summary.referrers)} />
              <StatCard label="Referred customers" value={num(d.summary.referredCustomers)} />
              <StatCard hint="Qualifying purchases only" label="Qualifying purchase amount" value={formatSom(d.summary.qualifyingAmountMinor)} />
            </StatGrid>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <SectionCard description="Events recorded in the selected period (not a single cohort)." title="Referral funnel">
                <HBarList items={d.funnel.map((f) => ({ name: STAGE_LABEL[f.stage], value: f.count, valueLabel: num(f.count) }))} />
              </SectionCard>
              <SectionCard description="All referrals by their current status." title="Current status">
                {d.currentStatus.length > 0 ? (
                  <HBarList items={d.currentStatus.map((s) => ({ name: s.status, value: s.count, valueLabel: num(s.count) }))} />
                ) : (
                  <EmptyState text="No referrals exist yet." title="No referrals" variant="inline" />
                )}
              </SectionCard>
            </div>

            <SectionCard description="Referrers with referral activity in the period. A usage table, not a ranking." flush title="Referrer activity">
              <DataTable columns={referrerColumns} empty={<EmptyState text="No referral activity in this period." title="No referrers" variant="inline" />} rowKey={(r) => r.customerId} rows={d.referrers} />
              <Pagination busy={loading} onPage={setPage} page={d.referrersPagination.page} pages={d.referrersPagination.totalPages} total={d.referrersPagination.total} />
            </SectionCard>

            <SectionCard description={`Latest ${num(d.referred.length)} of ${num(d.referredTotal)} referrals created in the period.`} flush title="Referred customers">
              <DataTable columns={referredColumns} empty={<EmptyState text="No referrals were created in this period." title="No referred customers" variant="inline" />} rowKey={(r) => r.referralId} rows={d.referred} />
            </SectionCard>

            <Notes notes={d.notes} />
          </>
        )}
      </ReportBody>
    </>
  );
}
