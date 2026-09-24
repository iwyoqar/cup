import { useEffect, useState } from 'react';
import { formatSom } from '../lib/format';
import { AdminPage, findNav } from '../lib/nav';
import { ReportsLoyaltyOverview } from '../lib/reportsTypes';
import { rangeParams, useReport } from '../lib/useReport';
import { Column, DataTable, DateRangePicker, DateRangeValue, EmptyState, FilterBar, HBarList, isRangeReady, PageHeader, Pagination, SearchInput, SectionCard, StatCard, StatGrid, StatusBadge } from '../ui';
import { Notes, num, PeriodHint, pctOrDash, ReportBody } from './reportsShared';

type CustomerRow = ReportsLoyaltyOverview['customerRows'][number];
const pts = (n: number) => `${num(n)} pts`;

const customerColumns: Column<CustomerRow>[] = [
  { key: 'n', header: 'Customer', cell: (r) => <span className="table__primary">{r.name ?? '—'}</span> },
  { key: 'ph', header: 'Phone', low: true, cell: (r) => r.phone ?? '—' },
  { key: 'l', header: 'Level', cell: (r) => r.level ?? '—' },
  { key: 'p', header: 'Points', numeric: true, cell: (r) => pts(r.pointsBalance) },
  { key: 'rw', header: 'Rewards available', numeric: true, cell: (r) => num(r.rewardsAvailable) },
  { key: 'cb', header: 'Cashback balance', numeric: true, low: true, cell: (r) => formatSom(r.cashbackBalanceMinor) },
  { key: 'a', header: 'Achievements', numeric: true, low: true, cell: (r) => num(r.achievements) },
];

// Loyalty — descriptive, over persisted loyalty records. "Now" figures (balances, levels, available rewards) and
// "In this period" figures (points activity, redemptions, cashback, achievements, birthday) are kept visibly apart.
// Points are points, never so'm. All-branch: loyalty records carry no reliable branch.
export function ReportsLoyaltyPage({ onNavigate }: { onNavigate: (page: AdminPage) => void }) {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last30', startDate: '', endDate: '' });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const ready = isRangeReady(range);
  const { item } = findNav('reports-loyalty');
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => setPage(1), [search]);
  const { data, error, loading, reload } = useReport<ReportsLoyaltyOverview>('loyalty', { ...rangeParams(range), search, page, limit: 50 }, ready);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <PeriodHint loading={loading} period={data?.period} />
      </FilterBar>

      <ReportBody data={data} error={error} loading={loading} ready={ready} reload={reload} title="Loyalty could not be loaded">
        {(d) => (
          <>
            <SectionCard actions={<StatusBadge>Current state</StatusBadge>} description="As of now — not affected by the selected period." title="Loyalty today">
              <StatGrid>
                <StatCard hint="Customers with a loyalty account (created on first loyalty interaction)" label="Loyalty customers" strong value={num(d.current.loyaltyCustomers)} />
                <StatCard hint="Sum of account balances" label="Current points balance" value={pts(d.current.pointsBalance)} />
                <StatCard hint={`${num(d.current.customersWithAvailableReward)} customers`} label="Rewards available now" value={num(d.current.rewardsAvailable)} />
                <StatCard label="Current cashback balance" value={formatSom(d.current.cashbackBalanceMinor)} />
              </StatGrid>
            </SectionCard>

            <SectionCard actions={<StatusBadge>Selected period</StatusBadge>} description="Activity recorded in the selected period." title="Loyalty activity">
              <StatGrid>
                <StatCard label="Points earned" value={pts(d.points.earned)} />
                <StatCard hint="No CUP flow spends points yet" label="Points spent" value={pts(d.points.spent)} />
                <StatCard label="Net points change" value={pts(d.points.netChange)} />
                <StatCard hint={`${num(d.rewards.customers)} customers`} label="Rewards redeemed" value={num(d.rewards.redeemed)} />
                <StatCard hint={`${num(d.cashback.customers)} customers`} label="Cashback granted" value={formatSom(d.cashback.grantedMinor)} />
                <StatCard hint="No CUP flow spends cashback yet" label="Cashback used" value="Not tracked" />
              </StatGrid>
              {d.points.byType.length > 0 && (
                <DataTable
                  columns={[
                    { key: 't', header: 'Ledger type', cell: (t) => t.type },
                    { key: 'e', header: 'Earned', numeric: true, cell: (t) => pts(t.earned) },
                    { key: 's', header: 'Spent', numeric: true, cell: (t) => pts(t.spent) },
                    { key: 'n', header: 'Entries', numeric: true, cell: (t) => num(t.entries) },
                  ]}
                  rowKey={(t) => t.type}
                  rows={d.points.byType}
                />
              )}
            </SectionCard>

            <div className="grid-2">
              <SectionCard actions={<StatusBadge>Current state</StatusBadge>} description="Current loyalty level distribution, derived from lifetime spend exactly as Loyalty 2.0 does." title="Current loyalty levels">
                {d.levels.length > 0 ? (
                  <HBarList
                    items={[
                      ...d.levels.map((l) => ({ name: l.name, value: l.customers, valueLabel: `${num(l.customers)} · ${pctOrDash(l.sharePercent)}` })),
                      ...(d.customersBelowFirstLevel > 0 ? [{ name: 'Below first level', value: d.customersBelowFirstLevel, valueLabel: num(d.customersBelowFirstLevel) }] : []),
                    ]}
                  />
                ) : (
                  <EmptyState text="No active loyalty levels are configured." title="No levels" variant="inline" />
                )}
              </SectionCard>

              <SectionCard
                actions={
                  <button className="button-secondary button--sm" onClick={() => onNavigate('rewards-5plus1')} type="button">
                    5+1 Coffee report →
                  </button>
                }
                description="Successful reward redemptions in the period, by program."
                title="Rewards"
              >
                <DataTable
                  columns={[
                    { key: 'n', header: 'Program', cell: (p) => <span className="table__primary">{p.name}</span> },
                    { key: 'r', header: 'Redemptions', numeric: true, cell: (p) => num(p.redemptions) },
                    { key: 'c', header: 'Customers', numeric: true, cell: (p) => num(p.customers) },
                  ]}
                  empty={<EmptyState text="No rewards were redeemed in this period." title="No redemptions" variant="inline" />}
                  rowKey={(p) => p.rewardProgramId}
                  rows={d.rewards.programs}
                />
              </SectionCard>
            </div>

            <div className="grid-2">
              <SectionCard description={`${num(d.achievements.unlocked)} unlocks by ${num(d.achievements.customers)} customers in the period.`} title="Achievements">
                <DataTable
                  columns={[
                    { key: 'n', header: 'Achievement', cell: (a) => <span className="table__primary">{a.name}</span> },
                    { key: 'u', header: 'Unlocks', numeric: true, cell: (a) => num(a.unlocks) },
                  ]}
                  empty={<EmptyState text="No achievements were unlocked in this period." title="No achievements" variant="inline" />}
                  rowKey={(a) => a.achievementId}
                  rows={d.achievements.byAchievement}
                />
              </SectionCard>
              <SectionCard description="Birthday rewards actually claimed in the period." title="Birthday rewards">
                <StatGrid>
                  <StatCard label="Claims" value={num(d.birthdayRewards.claimed)} />
                  <StatCard label="Customers" value={num(d.birthdayRewards.customers)} />
                  <StatCard label="Points granted" value={pts(d.birthdayRewards.points)} />
                </StatGrid>
              </SectionCard>
            </div>

            <SectionCard actions={<StatusBadge>Current state</StatusBadge>} description="Current loyalty state per customer, ordered by points balance." flush title="Current customer loyalty">
              <div style={{ padding: '0 16px 8px' }}>
                <SearchInput label="Search loyalty customers" onChange={setSearchInput} placeholder="Name or phone" value={searchInput} />
              </div>
              <DataTable columns={customerColumns} empty={<EmptyState text={search ? 'No loyalty customer matches this search.' : 'No loyalty accounts yet.'} title="No customers" variant="inline" />} rowKey={(r) => r.customerId} rows={d.customerRows} />
              <Pagination busy={loading} onPage={setPage} page={d.pagination.page} pages={d.pagination.totalPages} total={d.pagination.total} />
            </SectionCard>

            <Notes notes={d.notes} />
          </>
        )}
      </ReportBody>
    </>
  );
}
