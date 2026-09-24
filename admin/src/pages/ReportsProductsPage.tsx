import { useMemo, useState } from 'react';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { useReportsProducts } from '../lib/useReportsProducts';
import { ReportsProductRow, ReportsProductsOverview, ReportsSource } from '../lib/types';
import { Column, DataTable, DateRangePicker, DateRangeValue, ErrorState, FilterBar, FilterField, isRangeReady, LoadingState, PageHeader, SearchInput, SectionCard, StatCard, StatGrid } from '../ui';
import { number, PosterTotals, PosterUnavailable, ProductDetailModal, ProductsTable, ReconciliationCard, SortSelect, SortState, sortRows, somOrDash, SourceSelect } from './reportsProductShared';

type SortKey = 'revenue' | 'quantity' | 'averagePrice' | 'theoreticalGrossProfit' | 'theoreticalCOGS';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'quantity', label: 'Units' },
  { key: 'averagePrice', label: 'Avg. price' },
  { key: 'theoreticalGrossProfit', label: 'Theoretical gross profit' },
  { key: 'theoreticalCOGS', label: 'Theoretical COGS' },
];

const SORT_VALUE: Record<SortKey, (p: ReportsProductRow) => number | null> = {
  revenue: (p) => p.revenueMinor,
  quantity: (p) => p.quantity,
  averagePrice: (p) => p.averagePriceMinor,
  theoreticalGrossProfit: (p) => p.costing.theoreticalGrossProfitMinor,
  theoreticalCOGS: (p) => p.costing.theoreticalCOGSMinor,
};

type Unmapped = { posterProductId: string; name: string | null; quantity: number; revenueMinor: number };
const unmappedColumns: Column<Unmapped>[] = [
  { key: 'id', header: 'Poster product ID', cell: (u) => <span className="table__primary">{u.posterProductId}</span> },
  { key: 'name', header: 'Name (from Poster)', cell: (u) => u.name ?? '—' },
  { key: 'q', header: 'Units', numeric: true, cell: (u) => number(u.quantity) },
  { key: 'r', header: 'Revenue', numeric: true, cell: (u) => formatSom(u.revenueMinor) },
];

// Products — which products sell, what they bring in, and what their THEORETICAL cost is. The backend returns the
// canonical per-product aggregate (CUP orders + independent POS); search and sort run here on that list so typing does
// not re-read Poster. Costs without a recipe render as "—", never as zero.
export function ReportsProductsPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last7', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [source, setSource] = useState<ReportsSource>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState<SortKey>>({ by: 'revenue', direction: 'desc' });
  const [selected, setSelected] = useState<ReportsProductRow | null>(null);
  const ready = isRangeReady(range);
  const { data, error, loading, reload } = useReportsProducts({ ...range, branchId: branchId || undefined, categoryId: categoryId || undefined, source }, ready);
  const { item } = findNav('reports-products');

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLocaleLowerCase();
    const filtered = needle ? data.products.filter((p) => p.productName.toLocaleLowerCase().includes(needle)) : data.products;
    return sortRows(filtered, SORT_VALUE[sort.by], sort.direction, (p) => p.productName);
  }, [data, search, sort]);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />

      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <FilterField label="Branch">
          <select className="select" onChange={(e) => setBranchId(e.target.value)} value={branchId}>
            <option value="">All branches</option>
            {(data?.filters.branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </FilterField>
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
        <SortSelect onChange={setSort} options={SORT_OPTIONS} value={sort} />
        <SearchInput label="Search products" onChange={setSearch} placeholder="Search product" value={search} />
        {data && !error && (
          <span className="hint-text" style={{ alignSelf: 'center' }}>
            {data.period.startDate === data.period.endDate ? data.period.startDate : `${data.period.startDate} → ${data.period.endDate}`}
            {loading && ' · updating…'}
          </span>
        )}
      </FilterBar>

      {error && <ErrorState message={error} onRetry={reload} title="Products could not be loaded" />}
      {!data && !error && ready && <LoadingState variant="page" />}

      {data && !error && (
        <div className="stack" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity var(--motion-base) var(--ease)' }}>
          <Summary data={data} />

          {data.warnings.length > 0 && (
            <div className="callout">
              {data.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          )}

          <SectionCard
            description={`${search ? `${number(rows.length)} of ${number(data.products.length)} products match. ` : ''}Click a product for its CUP / POS split and costing. Theoretical figures use Poster recipe cost, not actual inventory COGS.`}
            flush
            title="Products"
          >
            <ProductsTable onSelect={setSelected} rows={rows} showCategory={!data.category} />
          </SectionCard>

          {data.unmappedPos.length > 0 && (
            <SectionCard description="Imported POS sales of Poster products with no CUP product. Counted in Analytics revenue, not in any product above." flush title="Unmapped POS products">
              <DataTable columns={unmappedColumns} rowKey={(u) => u.posterProductId} rows={data.unmappedPos} />
            </SectionCard>
          )}

          <PosterReference data={data} />
          <ReconciliationCard rec={data.reconciliation} />
        </div>
      )}

      {selected && <ProductDetailModal onClose={() => setSelected(null)} product={selected} />}
    </>
  );
}

function Summary({ data }: { data: ReportsProductsOverview }) {
  const s = data.summary;
  return (
    <StatGrid>
      <StatCard hint="Distinct products with sales" label="Products sold" value={number(s.productsSold)} />
      <StatCard label="Units sold" value={number(s.unitsSold)} />
      <StatCard hint="Sum of sale lines" label="Product revenue" strong value={formatSom(s.revenueMinor)} />
      <StatCard hint="Theoretical unit cost known" label="Products with recipe" value={`${number(s.productsWithRecipe)} of ${number(s.productsSold)}`} />
      <StatCard hint="Products with recipe only" label="Theoretical COGS" value={somOrDash(s.theoreticalCOGSMinor)} />
      <StatCard hint={`On ${formatSom(s.costedRevenueMinor)} of costed revenue`} label="Theoretical gross profit" value={somOrDash(s.theoreticalGrossProfitMinor)} />
    </StatGrid>
  );
}

// Poster's own product report — kept apart, never added to the CUP figures above. Only shown in full when there is
// something to reconcile: unmapped Poster products get a small list; none means no alarming empty section.
function PosterReference({ data }: { data: ReportsProductsOverview }) {
  const ref = data.posterReference;
  const unmapped = ref.unmapped;
  return (
    <SectionCard
      description="Poster's own product sales report (dash.getProductsSales) for the same dates — every sale Poster saw, CUP-originated included. Comparison only; never added to CUP figures. Not filtered by source or category."
      title="Poster POS reference"
    >
      {ref.available ? (
        <>
          <PosterTotals quantity={ref.totalQuantity} revenue={ref.totalRevenueMinor} />
          {unmapped.length > 0 && (
            <>
              <h3 style={{ margin: '16px 0 4px' }}>Unmapped Poster products</h3>
              <p className="hint-text">Sold in Poster but with no CUP product (matched only by Poster product ID). Not created in CUP, not dropped.</p>
              <DataTable
                columns={[
                  { key: 'id', header: 'Poster product ID', cell: (u) => u.posterProductId },
                  { key: 'name', header: 'Name', cell: (u) => <span className="table__primary">{u.name}</span> },
                  { key: 'q', header: 'Units', numeric: true, cell: (u) => number(u.quantity) },
                  { key: 'r', header: 'Revenue', numeric: true, cell: (u) => formatSom(u.revenueMinor) },
                ]}
                rowKey={(u) => u.posterProductId}
                rows={unmapped}
              />
            </>
          )}
        </>
      ) : (
        <PosterUnavailable reason={ref.unavailableReason} />
      )}
    </SectionCard>
  );
}
