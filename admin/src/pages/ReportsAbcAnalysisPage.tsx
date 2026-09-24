import { useState } from 'react';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { ReportsAbcOverview } from '../lib/reportsTypes';
import { ReportsSource } from '../lib/types';
import { rangeParams, useReport } from '../lib/useReport';
import { Column, DataTable, DateRangePicker, DateRangeValue, EmptyState, FilterBar, FilterField, HBarList, isRangeReady, KeyValue, PageHeader, SectionCard, StatCard, StatGrid, StatusBadge } from '../ui';
import { BranchSelect, Notes, num, PeriodHint, pctOrDash, ReportBody } from './reportsShared';
import { somOrDash, SourceSelect } from './reportsProductShared';

type Row = ReportsAbcOverview['rows'][number];
const CLASS_TONE = { A: 'ok', B: 'warn', C: 'neutral' } as const;

const columns: Column<Row>[] = [
  { key: 'c', header: 'Class', cell: (r) => <StatusBadge tone={CLASS_TONE[r.classification]}>{r.classification}</StatusBadge> },
  { key: 'n', header: 'Product', cell: (r) => <span className="table__primary">{r.productName}</span> },
  { key: 'cat', header: 'Category', low: true, cell: (r) => r.categoryName },
  { key: 'u', header: 'Units', numeric: true, cell: (r) => num(r.units) },
  { key: 'r', header: 'Revenue', numeric: true, cell: (r) => formatSom(r.revenueMinor) },
  { key: 's', header: 'Share', numeric: true, cell: (r) => pctOrDash(r.revenueSharePercent) },
  { key: 'cum', header: 'Cumulative', numeric: true, cell: (r) => pctOrDash(r.cumulativeRevenueSharePercent) },
  { key: 'cogs', header: 'Theoretical COGS', numeric: true, low: true, cell: (r) => somOrDash(r.theoreticalCOGSMinor) },
  { key: 'gp', header: 'Theoretical gross profit', numeric: true, low: true, cell: (r) => somOrDash(r.theoreticalGrossProfitMinor) },
];

// ABC Analysis — revenue-based Pareto classification of the products that sold in the selected period and filters. The
// backend recomputes it for every filter change (the population changes, so classes can change). Not a profitability
// or inventory classification.
export function ReportsAbcAnalysisPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last30', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [source, setSource] = useState<ReportsSource>('all');
  const ready = isRangeReady(range);
  const { item } = findNav('reports-abc');
  const { data, error, loading, reload } = useReport<ReportsAbcOverview>('abc-analysis', { ...rangeParams(range), branchId, categoryId, source }, ready);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <BranchSelect branches={data?.filters.branches ?? []} onChange={setBranchId} value={branchId} />
        <FilterField label="Category">
          <select className="select" onChange={(e) => setCategoryId(e.target.value)} value={categoryId}>
            <option value="">All categories</option>
            {(data?.filters.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </FilterField>
        <SourceSelect onChange={setSource} value={source} />
        <PeriodHint loading={loading} period={data?.period} />
      </FilterBar>

      <ReportBody data={data} error={error} loading={loading} ready={ready} reload={reload} title="ABC analysis could not be loaded">
        {(d) => {
          const cls = (c: 'A' | 'B' | 'C') => d.summary.classes.find((x) => x.classification === c)!;
          return (
            <>
              <StatGrid>
                <StatCard hint="Positive revenue in period" label="Products with sales" value={num(d.summary.productsWithSales)} />
                <StatCard label="Product revenue" strong value={formatSom(d.summary.productRevenueMinor)} />
                <StatCard hint={pctOrDash(cls('A').revenueSharePercent) + ' of revenue'} label="A products" value={num(cls('A').products)} />
                <StatCard hint={pctOrDash(cls('B').revenueSharePercent) + ' of revenue'} label="B products" value={num(cls('B').products)} />
                <StatCard hint={pctOrDash(cls('C').revenueSharePercent) + ' of revenue'} label="C products" value={num(cls('C').products)} />
                <StatCard hint="Active catalog products not classified" label="Zero-sales products" value={num(d.summary.zeroSalesCatalogProducts)} />
              </StatGrid>

              {d.rows.length === 0 ? (
                <SectionCard title="ABC products">
                  <EmptyState text={d.unmappedPos.revenueMinor > 0 ? 'Only sales of unmapped Poster products exist for these filters; they cannot be classified.' : 'No product sales available for ABC analysis.'} title="Nothing to classify" variant="inline" />
                </SectionCard>
              ) : (
                <>
                  <SectionCard description="Share of classified product revenue by class." title="Revenue distribution">
                    <HBarList items={d.summary.classes.map((c) => ({ name: `Class ${c.classification} · ${num(c.products)} products`, value: c.revenueMinor, valueLabel: `${formatSom(c.revenueMinor)} · ${pctOrDash(c.revenueSharePercent)}` }))} />
                  </SectionCard>
                  <SectionCard description="Ordered A → B → C, revenue descending within each class (ties by product ID)." flush title="ABC products">
                    <DataTable columns={columns} rowKey={(r) => r.productId} rows={d.rows} />
                  </SectionCard>
                </>
              )}

              <SectionCard description="How the classified revenue relates to the Products report for the same filters." title="Reconciliation">
                <KeyValue
                  rows={[
                    { key: 'p', label: 'Products report revenue (CUP products)', value: formatSom(d.reconciliation.productReportRevenueMinor) },
                    { key: 'a', label: 'Classified (positive revenue)', value: formatSom(d.reconciliation.abcRevenueMinor) },
                    { key: 'x', label: 'Excluded zero/negative revenue', value: formatSom(d.reconciliation.excludedNonPositiveMinor) },
                    { key: 'u', label: 'Unmapped POS products (not classifiable)', value: formatSom(d.reconciliation.unmappedPosRevenueMinor) },
                  ]}
                />
              </SectionCard>

              <Notes notes={d.notes} />
            </>
          );
        }}
      </ReportBody>
    </>
  );
}
