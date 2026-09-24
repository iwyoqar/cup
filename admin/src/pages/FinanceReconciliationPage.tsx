import { useState } from 'react';
import { findNav } from '../lib/nav';
import { FinanceFilterBar } from '../components/FinanceFilterBar';
import { FinanceRangeValue, isFinanceRangeReady } from '../components/FinancePeriodPicker';
import { FinanceReconciliationTab } from '../components/FinanceReconciliationTab';
import { PageHeader } from '../ui';

export function FinanceReconciliationPage() {
  const { item } = findNav('finance-reconciliation');
  const [range, setRange] = useState<FinanceRangeValue>({ period: 'thisMonth', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const ready = isFinanceRangeReady(range);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FinanceFilterBar branchId={branchId} onBranchChange={setBranchId} onRangeChange={setRange} range={range} />
      <FinanceReconciliationTab branchId={branchId || undefined} ready={ready} {...range} />
    </>
  );
}
