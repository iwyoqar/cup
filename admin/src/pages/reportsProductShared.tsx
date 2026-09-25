import { formatSom } from '../lib/format';
import { ReportsProductRow, ReportsReconciliation, ReportsSource } from '../lib/types';
import { Column, DataTable, EmptyState, FilterField, KeyValue, Modal, SectionCard, StatCard, StatGrid } from '../ui';

// Shared building blocks for Reports -> Products and Reports -> Categories (Phase C1/C2). Both pages render the same
// backend product-sales aggregate, so they share its vocabulary: THEORETICAL costing, "—" for no recipe (never 0),
// CUP vs POS as a breakdown of one figure, and Poster figures as a separate reference.

export const number = (n: number) => n.toLocaleString('ru-RU');
export const somOrDash = (n: number | null) => (n === null ? '—' : formatSom(n));
export const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`);

export const SOURCE_OPTIONS: { key: ReportsSource; label: string }[] = [
  { key: 'all', label: 'All sources' },
  { key: 'cup', label: 'CUP orders' },
  { key: 'pos', label: 'Independent POS' },
];

export function SourceSelect({ value, onChange }: { value: ReportsSource; onChange: (v: ReportsSource) => void }) {
  return (
    <FilterField label="Source">
      <select className="" onChange={(e) => onChange(e.target.value as ReportsSource)} value={value}>
        {SOURCE_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </FilterField>
  );
}

export interface SortState<K extends string> {
  by: K;
  direction: 'asc' | 'desc';
}

export function SortSelect<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: SortState<K>; onChange: (v: SortState<K>) => void }) {
  return (
    <FilterField label="Sort by">
      <div className="flex gap-1.5">
        <select className="" onChange={(e) => onChange({ ...value, by: e.target.value as K })} value={value.by}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <select aria-label="Sort direction" className="" onChange={(e) => onChange({ ...value, direction: e.target.value as 'asc' | 'desc' })} value={value.direction}>
          <option value="desc">High → low</option>
          <option value="asc">Low → high</option>
        </select>
      </div>
    </FilterField>
  );
}

// Sort helper matching the backend's rule: an unknown value (no recipe) always sorts last, never as 0.
export function sortRows<T>(rows: T[], value: (r: T) => number | null, direction: 'asc' | 'desc', tie: (r: T) => string): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null || vb === null) return va === vb ? tie(a).localeCompare(tie(b)) : va === null ? 1 : -1;
    return (va - vb) * sign || tie(a).localeCompare(tie(b));
  });
}

export function sourceLine(q: number, revenue: number) {
  return `${number(q)} units · ${formatSom(revenue)}`;
}

export function productColumns(showCategory: boolean): Column<ReportsProductRow>[] {
  return [
    { key: 'name', header: 'Product', cell: (p) => <span className="font-semibold text-black">{p.productName}</span> },
    ...(showCategory ? [{ key: 'category', header: 'Category', low: true, cell: (p: ReportsProductRow) => p.categoryName }] : []),
    { key: 'units', header: 'Units', numeric: true, cell: (p) => number(p.quantity) },
    { key: 'revenue', header: 'Revenue', numeric: true, cell: (p) => formatSom(p.revenueMinor) },
    { key: 'avg', header: 'Avg. price', numeric: true, low: true, cell: (p) => somOrDash(p.averagePriceMinor) },
    { key: 'cogs', header: 'Theoretical COGS', numeric: true, cell: (p) => somOrDash(p.costing.theoreticalCOGSMinor) },
    { key: 'gp', header: 'Theoretical gross profit', numeric: true, cell: (p) => somOrDash(p.costing.theoreticalGrossProfitMinor) },
    { key: 'recipe', header: 'Recipe', low: true, cell: (p) => (p.costing.hasRecipe ? 'Yes' : 'No') },
  ];
}

// Lightweight read-only product detail — reporting only, no product management.
export function ProductDetailModal({ product, onClose }: { product: ReportsProductRow; onClose: () => void }) {
  const c = product.costing;
  return (
    <Modal onClose={onClose} title={product.productName} wide>
      <KeyValue
        rows={[
          { key: 'cat', label: 'Category', value: product.categoryName },
          { key: 'pid', label: 'Poster product ID', value: product.posterProductId },
          { key: 'units', label: 'Units sold', value: number(product.quantity) },
          { key: 'rev', label: 'Revenue', value: formatSom(product.revenueMinor) },
          { key: 'cup', label: 'CUP orders', value: sourceLine(product.source.cupQuantity, product.source.cupRevenueMinor) },
          { key: 'pos', label: 'Independent POS', value: sourceLine(product.source.posQuantity, product.source.posRevenueMinor) },
          { key: 'avg', label: 'Average selling price', value: somOrDash(product.averagePriceMinor) },
          { key: 'recipe', label: 'Recipe in Poster', value: c.hasRecipe ? 'Yes' : 'No — cost unknown' },
          { key: 'unit', label: 'Theoretical unit cost', value: somOrDash(c.theoreticalCostMinor) },
          { key: 'cogs', label: 'Theoretical COGS', value: somOrDash(c.theoreticalCOGSMinor) },
          { key: 'gp', label: 'Theoretical gross profit', value: somOrDash(c.theoreticalGrossProfitMinor) },
          {
            key: 'poster',
            label: 'Poster reference (comparison only)',
            value: product.posterReference ? sourceLine(product.posterReference.quantity, product.posterReference.revenueMinor) : 'Not available',
          },
        ]}
      />
      <p className="text-[13px] leading-snug text-muted mt-3">
        Theoretical figures use the recipe cost Poster reports for this product — not actual inventory COGS. The Poster reference covers every sale Poster saw
        (CUP-originated included) and is never added to CUP figures.
      </p>
    </Modal>
  );
}

// How line-based product/category revenue relates to Analytics' order/receipt-based revenue. Shown, never "fixed".
export function ReconciliationCard({ rec }: { rec: ReportsReconciliation }) {
  return (
    <SectionCard description="Analytics revenue (order and receipt totals) split into this report's line-based revenue and what lives outside product lines, for the same period, branch and source. Category/search filters do not apply here." title="Reconciliation">
      <KeyValue
        rows={[
          { key: 'canon', label: 'Analytics revenue', value: formatSom(rec.canonicalRevenueMinor) },
          { key: 'prod', label: 'Product-line revenue (CUP products)', value: formatSom(rec.productRevenueMinor) },
          { key: 'unm', label: 'Unmapped POS product lines', value: formatSom(rec.unmappedPosRevenueMinor) },
          { key: 'cupd', label: 'CUP order-level difference (e.g. promotion discounts)', value: formatSom(rec.cupOrderLevelDifferenceMinor) },
          { key: 'posd', label: 'POS receipt-level difference', value: formatSom(rec.posReceiptLevelDifferenceMinor) },
        ]}
      />
    </SectionCard>
  );
}

export function PosterUnavailable({ reason }: { reason: 'poster_unavailable' | 'malformed_response' | null }) {
  return (
    <EmptyState
      text={reason === 'malformed_response' ? 'Poster returned a report CUP could not read reliably, so no Poster figures are shown.' : "Poster's report could not be read for this period. CUP figures above are unaffected."}
      title="Poster reference unavailable"
      variant="inline"
    />
  );
}

export function PosterTotals({ quantity, revenue }: { quantity: number | null; revenue: number | null }) {
  return (
    <StatGrid>
      <StatCard label="Poster units" value={quantity === null ? '—' : number(quantity)} />
      <StatCard label="Poster revenue" value={somOrDash(revenue)} />
    </StatGrid>
  );
}

export function ProductsTable({ rows, showCategory, onSelect }: { rows: ReportsProductRow[]; showCategory: boolean; onSelect: (p: ReportsProductRow) => void }) {
  return (
    <DataTable
      columns={productColumns(showCategory)}
      empty={<EmptyState text="No product had qualifying sales for these filters." title="No product sales" variant="inline" />}
      onRowClick={onSelect}
      rowKey={(p) => p.productId}
      rows={rows}
    />
  );
}
