import { useState } from 'react';
import { formatDate, formatDateTime } from '../lib/format';
import { findNav } from '../lib/nav';
import { ReportsPromotionRow, ReportsPromotionsOverview } from '../lib/reportsTypes';
import { rangeParams, useReport } from '../lib/useReport';
import { Column, DataTable, DateRangePicker, DateRangeValue, EmptyState, FilterBar, isRangeReady, KeyValue, Modal, PageHeader, SectionCard, StatCard, StatGrid } from '../ui';
import { BranchSelect, Notes, num, PeriodHint, ReportBody } from './reportsShared';
import { SortSelect, SortState } from './reportsProductShared';

type SortKey = 'redemptions' | 'customers' | 'lastRedemption';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'redemptions', label: 'Redemptions' },
  { key: 'customers', label: 'Customers' },
  { key: 'lastRedemption', label: 'Last redemption' },
];
const STATUS_LABEL = { ACTIVE: 'Active', INACTIVE: 'Inactive', SCHEDULED: 'Scheduled', EXPIRED: 'Expired' } as const;

// The configured benefit, as stored on the promotion — never an applied discount amount.
function benefit(type: string, value: number | null, productName: string | null, qty: number | null): string {
  if (type === 'PERCENT_DISCOUNT') return value === null ? type : `${value}% (configured)`;
  if (type === 'FIXED_DISCOUNT') return value === null ? type : `${num(value)} so'm (configured)`;
  if (type === 'FREE_PRODUCT') return `${qty ?? 1} × ${productName ?? 'product'}`;
  if (type === 'LOYALTY_POINTS') return value === null ? type : `${num(value)} pts`;
  return type;
}

const columns: Column<ReportsPromotionRow>[] = [
  { key: 'n', header: 'Promotion', cell: (p) => <span className="table__primary">{p.promotionName}</span> },
  { key: 't', header: 'Type', low: true, cell: (p) => p.benefitType || '—' },
  { key: 's', header: 'Status (now)', cell: (p) => STATUS_LABEL[p.status] },
  { key: 'r', header: 'Redemptions', numeric: true, cell: (p) => num(p.redemptions) },
  { key: 'c', header: 'Customers', numeric: true, cell: (p) => num(p.uniqueCustomers) },
  { key: 'o', header: 'Linked orders', numeric: true, low: true, cell: (p) => num(p.linkedOrders) },
  { key: 'l', header: 'Last redemption', low: true, cell: (p) => (p.lastRedemptionAt ? formatDate(p.lastRedemptionAt) : '—') },
];

// Promotions — usage from recorded redemptions only. The applied discount amount is not stored, so none is shown; no
// revenue is attributed to a promotion. Status is current; redemption figures are for the selected period.
export function ReportsPromotionsPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last30', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const [sort, setSort] = useState<SortState<SortKey>>({ by: 'redemptions', direction: 'desc' });
  const [selected, setSelected] = useState<ReportsPromotionRow | null>(null);
  const ready = isRangeReady(range);
  const { item } = findNav('reports-promotions');
  const params = { ...rangeParams(range), branchId };
  const { data, error, loading, reload } = useReport<ReportsPromotionsOverview>('promotions', { ...params, sortBy: sort.by, sortDirection: sort.direction }, ready);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <BranchSelect branches={data?.filters.branches ?? []} onChange={setBranchId} value={branchId} />
        <SortSelect onChange={setSort} options={SORT_OPTIONS} value={sort} />
        <PeriodHint loading={loading} period={data?.period} />
      </FilterBar>

      <ReportBody data={data} error={error} loading={loading} ready={ready} reload={reload} title="Promotions could not be loaded">
        {(d) => (
          <>
            <StatGrid>
              <StatCard hint="Current state" label="Active promotions" value={num(d.summary.activePromotions)} />
              <StatCard label="Promotions used" value={num(d.summary.promotionsUsed)} />
              <StatCard label="Total redemptions" strong value={num(d.summary.totalRedemptions)} />
              <StatCard label="Unique customers" value={num(d.summary.uniqueCustomers)} />
              <StatCard label="Orders with promotion" value={num(d.summary.ordersWithPromotion)} />
              <StatCard hint="Active now, not redeemed in period" label="Zero-redemption promotions" value={num(d.summary.activeWithZeroRedemptions)} />
            </StatGrid>

            <SectionCard description="Promotion usage in the selected period. Click a promotion for details." flush title="Promotion usage">
              <DataTable columns={columns} empty={<EmptyState text="No promotions are configured." title="No promotions" variant="inline" />} onRowClick={setSelected} rowKey={(p) => p.promotionId} rows={d.promotions} />
            </SectionCard>

            <SectionCard description="The latest 20 recorded redemptions in the period. Value is the configured benefit recorded on the redemption, not the discount applied." flush title="Recent redemptions">
              <DataTable
                columns={[
                  { key: 'd', header: 'Date', cell: (r) => formatDateTime(r.redeemedAt) },
                  { key: 'p', header: 'Promotion', cell: (r) => <span className="table__primary">{r.promotionName}</span> },
                  { key: 'c', header: 'Customer', cell: (r) => r.customerName ?? 'Unknown customer' },
                  { key: 'o', header: 'Order', low: true, cell: (r) => (r.orderId ? r.orderId.slice(-8) : '—') },
                  { key: 'b', header: 'Branch', low: true, cell: (r) => r.branchName ?? '—' },
                  { key: 'v', header: 'Benefit', low: true, cell: (r) => benefit(r.benefitType, r.benefitValue, r.benefitProductName, null) },
                ]}
                empty={<EmptyState text="No promotion was redeemed in this period." title="No redemptions" variant="inline" />}
                rowKey={(r) => r.redemptionId}
                rows={d.recentRedemptions}
              />
            </SectionCard>

            <Notes notes={d.notes} />
          </>
        )}
      </ReportBody>

      {selected && <PromotionDetail onClose={() => setSelected(null)} params={params} promotion={selected} />}
    </>
  );
}

// Read-only detail. Its redemption list is fetched for THIS promotion (promotionId filter), same period and branch.
function PromotionDetail({ promotion, params, onClose }: { promotion: ReportsPromotionRow; params: Record<string, string | undefined>; onClose: () => void }) {
  const { data, error, loading } = useReport<ReportsPromotionsOverview>('promotions', { ...params, promotionId: promotion.promotionId }, true);
  return (
    <Modal onClose={onClose} title={promotion.promotionName} wide>
      <KeyValue
        rows={[
          { key: 't', label: 'Type', value: promotion.benefitType },
          { key: 'b', label: 'Configured benefit', value: benefit(promotion.benefitType, promotion.benefitValue, promotion.benefitProductName, promotion.benefitQuantity) },
          { key: 's', label: 'Current status', value: STATUS_LABEL[promotion.status] },
          { key: 'v', label: 'Validity', value: `${formatDate(promotion.startsAt)} – ${promotion.endsAt ? formatDate(promotion.endsAt) : 'open'}` },
          { key: 'r', label: 'Redemptions in period', value: num(promotion.redemptions) },
          { key: 'c', label: 'Unique customers in period', value: num(promotion.uniqueCustomers) },
          { key: 'o', label: 'Linked orders in period', value: num(promotion.linkedOrders) },
          { key: 'f', label: 'First / last redemption', value: `${promotion.firstRedemptionAt ? formatDateTime(promotion.firstRedemptionAt) : '—'} / ${promotion.lastRedemptionAt ? formatDateTime(promotion.lastRedemptionAt) : '—'}` },
          { key: 'd', label: 'Discount value', value: 'Not tracked' },
        ]}
      />
      <h3 style={{ margin: '16px 0 8px' }}>Recent redemptions (latest 20 in period)</h3>
      {error && <p className="error-text">{error}</p>}
      {!data && loading && <p className="hint-text">Loading…</p>}
      {data && (
        <DataTable
          columns={[
            { key: 'd', header: 'Date', cell: (r) => formatDateTime(r.redeemedAt) },
            { key: 'c', header: 'Customer', cell: (r) => r.customerName ?? 'Unknown customer' },
            { key: 'b', header: 'Branch', cell: (r) => r.branchName ?? '—' },
          ]}
          empty={<EmptyState text="This promotion was not redeemed in the selected period." title="No redemptions" variant="inline" />}
          rowKey={(r) => r.redemptionId}
          rows={data.recentRedemptions}
        />
      )}
    </Modal>
  );
}
