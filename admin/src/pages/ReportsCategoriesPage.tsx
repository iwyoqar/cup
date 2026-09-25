import { useMemo, useState } from 'react';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { useReportsCategories } from '../lib/useReportsCategories';
import { useReportsProducts } from '../lib/useReportsProducts';
import { ReportsCategoriesOverview, ReportsCategoryRow, ReportsProductRow, ReportsSource } from '../lib/types';
import { Button, Column, cx, DataTable, DateRangePicker, DateRangeValue, EmptyState, ErrorState, FilterBar, FilterField, isRangeReady, KeyValue, LoadingState, Modal, PageHeader, SectionCard, StatCard, StatGrid, StatusBadge } from '../ui';
import { number, pct, PosterTotals, PosterUnavailable, ProductDetailModal, ProductsTable, ReconciliationCard, SortSelect, SortState, sortRows, somOrDash, SourceSelect, sourceLine } from './reportsProductShared';

type SortKey = 'revenue' | 'units' | 'productCount' | 'theoreticalCOGS' | 'theoreticalGrossProfit';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'units', label: 'Units' },
  { key: 'productCount', label: 'Products' },
  { key: 'theoreticalCOGS', label: 'Theoretical COGS' },
  { key: 'theoreticalGrossProfit', label: 'Theoretical gross profit' },
];

const SORT_VALUE: Record<SortKey, (c: ReportsCategoryRow) => number | null> = {
  revenue: (c) => c.revenueMinor,
  units: (c) => c.unitsSold,
  productCount: (c) => c.productCount,
  theoreticalCOGS: (c) => c.costing.theoreticalCOGSMinor,
  theoreticalGrossProfit: (c) => c.costing.theoreticalGrossProfitMinor,
};

const columns: Column<ReportsCategoryRow>[] = [
  {
    key: 'name',
    header: 'Category',
    cell: (c) => (
      <span className="font-semibold text-black">
        {c.categoryName}
        {!c.categoryActive && ' (inactive)'}
      </span>
    ),
  },
  { key: 'products', header: 'Products', numeric: true, cell: (c) => number(c.productCount) },
  { key: 'units', header: 'Units', numeric: true, cell: (c) => number(c.unitsSold) },
  { key: 'revenue', header: 'Revenue', numeric: true, cell: (c) => formatSom(c.revenueMinor) },
  { key: 'avg', header: 'Avg. price', numeric: true, low: true, cell: (c) => somOrDash(c.averageUnitPriceMinor) },
  { key: 'cogs', header: 'Theoretical COGS', numeric: true, cell: (c) => somOrDash(c.costing.theoreticalCOGSMinor) },
  { key: 'gp', header: 'Theoretical gross profit', numeric: true, cell: (c) => somOrDash(c.costing.theoreticalGrossProfitMinor) },
  { key: 'cov', header: 'Recipe coverage', numeric: true, low: true, cell: (c) => pct(c.costing.recipeCoveragePercent) },
];

// Categories — how sales are distributed across CUP product categories. The backend groups the SAME product-sales
// aggregate the Products report uses, so the two always agree; products with no CUP category appear as an explicit
// "Uncategorized" row. Theoretical COGS covers only products with a recipe — coverage is shown next to it.
export function ReportsCategoriesPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last7', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const [source, setSource] = useState<ReportsSource>('all');
  const [sort, setSort] = useState<SortState<SortKey>>({ by: 'revenue', direction: 'desc' });
  const [selected, setSelected] = useState<ReportsCategoryRow | null>(null);
  const [showUncategorized, setShowUncategorized] = useState(false);
  const ready = isRangeReady(range);
  const filters = { ...range, branchId: branchId || undefined, source };
  const { data, error, loading, reload } = useReportsCategories(filters, ready);
  const { item } = findNav('reports-categories');

  const rows = useMemo(() => (data ? sortRows(data.categories, SORT_VALUE[sort.by], sort.direction, (c) => c.categoryName) : []), [data, sort]);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />

      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <FilterField label="Branch">
          <select className="" onChange={(e) => setBranchId(e.target.value)} value={branchId}>
            <option value="">All branches</option>
            {(data?.filters.branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </FilterField>
        <SourceSelect onChange={setSource} value={source} />
        <SortSelect onChange={setSort} options={SORT_OPTIONS} value={sort} />
        {data && !error && (
          <span className="text-[13px] leading-snug text-muted self-center">
            {data.period.startDate === data.period.endDate ? data.period.startDate : `${data.period.startDate} → ${data.period.endDate}`}
            {loading && ' · updating…'}
          </span>
        )}
      </FilterBar>

      {error && <ErrorState message={error} onRetry={reload} title="Categories could not be loaded" />}
      {!data && !error && ready && <LoadingState variant="page" />}

      {data && !error && (
        <div className={cx('flex min-w-0 flex-col gap-5 transition-opacity duration-200', loading && 'opacity-60')}>
          <Summary data={data} />

          {data.warnings.length > 0 && (
            <div className="block space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed [&_p]:m-0 border-muted-cream bg-neutral-bg text-muted-cream">
              {data.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          )}

          <SectionCard
            description="Products = distinct products sold in the period (not catalog size). Recipe coverage = sold products with a theoretical cost ÷ sold products. Click a category for its products."
            flush
            title="Categories"
          >
            <DataTable
              columns={columns}
              empty={<EmptyState text={data.uncategorized ? 'Only uncategorized sales were recorded — see below.' : 'No category had qualifying sales for these filters.'} title="No category sales" variant="inline" />}
              onRowClick={setSelected}
              rowKey={(c) => c.categoryId}
              rows={rows}
            />
          </SectionCard>

          {data.uncategorized && (
            <SectionCard
              actions={
                <Button onClick={() => setShowUncategorized((v) => !v)} variant="secondary">
                  {showUncategorized ? 'Hide products' : 'Show products'}
                </Button>
              }
              description="Imported POS sales of Poster products with no CUP product, so no CUP category. Counted in totals, never assigned to a category."
              title="Uncategorized"
            >
              <StatGrid>
                <StatCard label="Products" value={number(data.uncategorized.productCount)} />
                <StatCard label="Units" value={number(data.uncategorized.unitsSold)} />
                <StatCard label="Revenue" value={formatSom(data.uncategorized.revenueMinor)} />
                <StatCard hint="No CUP product, so no recipe" label="Theoretical COGS" value="—" />
              </StatGrid>
              {showUncategorized && (
                <DataTable
                  columns={[
                    { key: 'id', header: 'Poster product ID', cell: (u) => <span className="font-semibold text-black">{u.posterProductId}</span> },
                    { key: 'q', header: 'Units', numeric: true, cell: (u) => number(u.quantity) },
                    { key: 'r', header: 'Revenue', numeric: true, cell: (u) => formatSom(u.revenueMinor) },
                  ]}
                  rowKey={(u) => u.posterProductId}
                  rows={data.uncategorized.products}
                />
              )}
            </SectionCard>
          )}

          <PosterReference data={data} />
          <ReconciliationCard rec={data.reconciliation} />
        </div>
      )}

      {selected && <CategoryDetail category={selected} filters={filters} onClose={() => setSelected(null)} />}
    </>
  );
}

function Summary({ data }: { data: ReportsCategoriesOverview }) {
  const s = data.summary;
  return (
    <StatGrid>
      <StatCard label="Categories with sales" value={number(s.categoriesWithSales)} />
      <StatCard hint={data.uncategorized ? 'Incl. uncategorized' : undefined} label="Units sold" value={number(s.unitsSold)} />
      <StatCard hint={data.uncategorized ? 'Incl. uncategorized' : 'Sum of sale lines'} label="Category revenue" strong value={formatSom(s.revenueMinor)} />
      <StatCard hint="Distinct products with sales" label="Products sold" value={number(s.productsSold)} />
      <StatCard hint={`${number(s.productsWithRecipe)} of ${number(s.productsSold)} sold products`} label="Recipe coverage" value={pct(s.recipeCoveragePercent)} />
      <StatCard hint="Products with recipe only" label="Theoretical COGS" value={somOrDash(s.theoreticalCOGSMinor)} />
      <StatCard hint={`On ${formatSom(s.costedRevenueMinor)} of costed revenue`} label="Theoretical gross profit" value={somOrDash(s.theoreticalGrossProfitMinor)} />
    </StatGrid>
  );
}

// Category detail: the row's own figures, plus its products — read from the Products report endpoint with this
// category as a filter (the same aggregate, never a second calculation).
function CategoryDetail({ category, filters, onClose }: { category: ReportsCategoryRow; filters: DateRangeValue & { branchId?: string; source: ReportsSource }; onClose: () => void }) {
  const { data, error, loading, reload } = useReportsProducts({ ...filters, categoryId: category.categoryId }, true);
  const [product, setProduct] = useState<ReportsProductRow | null>(null);
  const c = category.costing;
  return (
    <Modal onClose={onClose} title={category.categoryName} wide>
      {category.isPosterTopScreen && (
        <p className="mt-0">
          <StatusBadge tone="warn">Poster top-screen category</StatusBadge>
        </p>
      )}
      <KeyValue
        rows={[
          { key: 'p', label: 'Products sold', value: number(category.productCount) },
          { key: 'u', label: 'Units', value: number(category.unitsSold) },
          { key: 'r', label: 'Revenue', value: formatSom(category.revenueMinor) },
          { key: 'cup', label: 'CUP orders', value: sourceLine(category.source.cupQuantity, category.source.cupRevenueMinor) },
          { key: 'pos', label: 'Independent POS', value: sourceLine(category.source.posQuantity, category.source.posRevenueMinor) },
          { key: 'avg', label: 'Average unit price', value: somOrDash(category.averageUnitPriceMinor) },
          { key: 'cov', label: 'Recipe coverage', value: `${pct(c.recipeCoveragePercent)} (${number(c.productsWithRecipe)} of ${number(category.productCount)})` },
          { key: 'cogs', label: 'Theoretical COGS (products with recipe)', value: somOrDash(c.theoreticalCOGSMinor) },
          { key: 'gp', label: 'Theoretical gross profit (products with recipe)', value: somOrDash(c.theoreticalGrossProfitMinor) },
          { key: 'poster', label: 'Poster reference (comparison only)', value: category.posterReference ? sourceLine(category.posterReference.quantity, category.posterReference.revenueMinor) : 'Not available' },
        ]}
      />
      <h3 className="mt-4 mb-2 mx-0">Products</h3>
      {error && <ErrorState message={error} onRetry={reload} title="Products could not be loaded" />}
      {!data && !error && loading && <LoadingState />}
      {data && !error && <ProductsTable onSelect={setProduct} rows={data.products} showCategory={false} />}
      {product && <ProductDetailModal onClose={() => setProduct(null)} product={product} />}
    </Modal>
  );
}

function PosterReference({ data }: { data: ReportsCategoriesOverview }) {
  const ref = data.posterReference;
  return (
    <SectionCard
      description="Poster's own category sales report (dash.getCategoriesSales) for the same dates — every sale Poster saw, CUP-originated included. Matched to CUP categories by Poster category ID only. Comparison only; not filtered by source."
      title="Poster POS reference"
    >
      {ref.available ? (
        <>
          <PosterTotals quantity={ref.totalQuantity} revenue={ref.totalRevenueMinor} />
          {ref.unmapped.length > 0 && (
            <>
              <h3 className="mt-4 mb-1 mx-0">Unmapped Poster categories</h3>
              <p className="text-[13px] leading-snug text-muted">Poster categories with no CUP category. Not created in CUP.</p>
              <DataTable
                columns={[
                  { key: 'id', header: 'Poster category ID', cell: (u) => u.posterCategoryId },
                  { key: 'name', header: 'Name', cell: (u) => <span className="font-semibold text-black">{u.name}</span> },
                  { key: 'q', header: 'Units', numeric: true, cell: (u) => number(u.quantity) },
                  { key: 'r', header: 'Revenue', numeric: true, cell: (u) => formatSom(u.revenueMinor) },
                ]}
                rowKey={(u) => u.posterCategoryId}
                rows={ref.unmapped}
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
