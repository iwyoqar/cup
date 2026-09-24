// Reports Phase G — the ABC classifier. Pure: no I/O, no clock; the same input always gives the same output.
//
// Population: products with STRICTLY POSITIVE revenue only (the caller excludes zero/negative rows).
// Order: revenue descending, ties broken by productId ascending (never database order).
// Class is decided by the cumulative share BEFORE the product, so the product that crosses a boundary stays in the
// lower-letter class:
//   A — cumulative share before it is < 80%   (the product that pushes the total past 80% is still A)
//   B — cumulative share before it is < 95%   (the product that pushes the total past 95% is still B)
//   C — everything after that
// All comparisons use integer arithmetic on whole-UZS amounts (prev * 100 < 80 * total), so no float can move a
// product across a boundary. Shares are returned as percentages for display only.

export type AbcClass = 'A' | 'B' | 'C';

export interface AbcInput {
  productId: string;
  revenueMinor: number; // must be > 0
}

export interface AbcResult extends AbcInput {
  classification: AbcClass;
  revenueSharePercent: number; // display only
  cumulativeRevenueSharePercent: number; // display only, after this product
}

export const ABC_A_LIMIT_PERCENT = 80;
export const ABC_B_LIMIT_PERCENT = 95;

export function classifyAbc(rows: readonly AbcInput[]): AbcResult[] {
  const sorted = [...rows].sort((a, b) => b.revenueMinor - a.revenueMinor || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
  const total = sorted.reduce((s, r) => s + r.revenueMinor, 0);
  if (total <= 0) return [];
  let before = 0;
  return sorted.map((r) => {
    const classification: AbcClass = before * 100 < ABC_A_LIMIT_PERCENT * total ? 'A' : before * 100 < ABC_B_LIMIT_PERCENT * total ? 'B' : 'C';
    before += r.revenueMinor;
    return {
      ...r,
      classification,
      revenueSharePercent: Math.round((r.revenueMinor * 10_000) / total) / 100,
      cumulativeRevenueSharePercent: Math.round((before * 10_000) / total) / 100,
    };
  });
}
