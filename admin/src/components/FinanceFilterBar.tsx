import { useEffect, useState } from 'react';
import { fetchFinanceOverview } from '../lib/adminFinance';
import { FilterBar, FilterField } from '../ui';
import { FinancePeriodPicker, FinanceRangeValue } from './FinancePeriodPicker';

// Shared by every Finance page that takes a period/branch filter (Overview, P&L, Cash Flow,
// Reconciliation) — one implementation, not duplicated per page, per the Sidebar/Finance refactor's
// own "avoid duplicated components" instruction. Each page still owns its own `range`/`branchId`
// state and data fetch; this only renders the two controls.
export function FinanceFilterBar({ range, onRangeChange, branchId, onBranchChange }: { range: FinanceRangeValue; onRangeChange: (r: FinanceRangeValue) => void; branchId: string; onBranchChange: (id: string) => void }) {
  return (
    <FilterBar>
      <FinancePeriodPicker onChange={onRangeChange} value={range} />
      <FilterField label="Branch">
        <select className="select" onChange={(e) => onBranchChange(e.target.value)} value={branchId}>
          <option value="">All branches</option>
          <BranchOptions />
        </select>
      </FilterField>
    </FilterBar>
  );
}

// A tiny local cache so the branch <select> doesn't refetch on every mount — filters.branches comes
// back on every overview/pnl/cash-flow response anyway, this just avoids an empty dropdown before
// the first response lands on whichever Finance page loaded first.
let cachedBranches: { id: string; name: string }[] = [];
function BranchOptions() {
  const [branches, setBranches] = useState(cachedBranches);
  useEffect(() => {
    if (cachedBranches.length > 0) return;
    fetchFinanceOverview({ period: 'today' })
      .then((o) => {
        cachedBranches = o.filters.branches;
        setBranches(o.filters.branches);
      })
      .catch(() => undefined);
  }, []);
  return (
    <>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </>
  );
}
