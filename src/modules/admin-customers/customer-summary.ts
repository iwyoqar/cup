// Phase 11.4 — pure composition of the two canonical purchase sources into ONE customer summary. No I/O and no new
// definitions: the CUP figures come from CustomerMetricsService (statuses in CUSTOMER_METRICS_ORDER_STATUSES) and the POS
// figures from PosterImportedActivityService (status IMPORTED only), exactly the same rules as Analytics V1. Money is
// whole-UZS integers; the average is the only derived number and is rounded to an integer.

export interface BranchTally {
  branchId: string;
  count: number;
  mostRecentAt: Date;
}

export interface SourceTotals {
  count: number;
  totalMinor: number;
  firstAt: Date | null;
  lastAt: Date | null;
  branches: BranchTally[];
}

export interface UnifiedSummary {
  totalPurchases: number;
  totalRevenueMinor: number;
  averageCheckMinor: number;
  firstPurchaseAt: Date | null;
  lastPurchaseAt: Date | null;
  cupOrderCount: number;
  cupRevenueMinor: number;
  posPurchaseCount: number;
  posRevenueMinor: number;
  favoriteBranchId: string | null;
}

// Highest purchase count wins, ties broken by the most recently used branch — the same rule
// CustomerMetricsService applies to CUP-only favorite branches.
export function pickFavoriteBranchId(tallies: BranchTally[]): string | null {
  const merged = new Map<string, BranchTally>();
  for (const t of tallies) {
    const existing = merged.get(t.branchId);
    if (!existing) merged.set(t.branchId, { ...t });
    else {
      existing.count += t.count;
      if (t.mostRecentAt > existing.mostRecentAt) existing.mostRecentAt = t.mostRecentAt;
    }
  }
  let best: BranchTally | null = null;
  for (const candidate of merged.values()) {
    if (!best || candidate.count > best.count || (candidate.count === best.count && candidate.mostRecentAt > best.mostRecentAt)) best = candidate;
  }
  return best ? best.branchId : null;
}

const earliest = (a: Date | null, b: Date | null): Date | null => (a && b ? (a < b ? a : b) : (a ?? b));
const latest = (a: Date | null, b: Date | null): Date | null => (a && b ? (a > b ? a : b) : (a ?? b));

export function combineSources(cup: SourceTotals, pos: SourceTotals): UnifiedSummary {
  const totalPurchases = cup.count + pos.count;
  const totalRevenueMinor = cup.totalMinor + pos.totalMinor;
  return {
    totalPurchases,
    totalRevenueMinor,
    averageCheckMinor: totalPurchases > 0 ? Math.round(totalRevenueMinor / totalPurchases) : 0,
    firstPurchaseAt: earliest(cup.firstAt, pos.firstAt),
    lastPurchaseAt: latest(cup.lastAt, pos.lastAt),
    cupOrderCount: cup.count,
    cupRevenueMinor: cup.totalMinor,
    posPurchaseCount: pos.count,
    posRevenueMinor: pos.totalMinor,
    favoriteBranchId: pickFavoriteBranchId([...cup.branches, ...pos.branches]),
  };
}
