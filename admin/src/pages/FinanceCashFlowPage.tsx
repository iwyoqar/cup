import { useEffect, useState } from 'react';
import { fetchFinanceCashFlow, fetchFinanceRoi } from '../lib/adminFinance';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { FinanceRoi } from '../lib/types';
import { FinanceFilterBar } from '../components/FinanceFilterBar';
import { FinanceRangeValue, isFinanceRangeReady } from '../components/FinancePeriodPicker';
import { useFinanceData } from '../components/useFinanceData';
import { BarChart, ChartContainer, cx, ErrorState, LoadingState, PageHeader, SectionCard, StatCard, StatGrid } from '../ui';

export function FinanceCashFlowPage() {
  const { item } = findNav('finance-cash-flow');
  const [range, setRange] = useState<FinanceRangeValue>({ period: 'thisMonth', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const ready = isFinanceRangeReady(range);
  const filters = { ...range, branchId: branchId || undefined };

  const { data, error, loading } = useFinanceData(() => fetchFinanceCashFlow(filters), [filters.period, filters.startDate, filters.endDate, filters.branchId], ready);
  const [roi, setRoi] = useState<FinanceRoi | null>(null);
  useEffect(() => {
    if (!ready) return;
    fetchFinanceRoi(filters)
      .then(setRoi)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.period, filters.startDate, filters.endDate, filters.branchId, ready]);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FinanceFilterBar branchId={branchId} onBranchChange={setBranchId} onRangeChange={setRange} range={range} />

      {error && <ErrorState message={error} title="Cash flow could not be loaded" />}
      {!data && !error && <LoadingState variant="page" />}

      {data && (
        <div className={cx('flex min-w-0 flex-col gap-5 transition-opacity duration-200', loading && 'opacity-60')}>
          <StatGrid>
            <StatCard hint="not reconciled against a real statement — see note below" label="Opening balance" value={formatSom(data.openingBalance)} />
            <StatCard label="Cash in" value={formatSom(data.cashIn.total)} />
            <StatCard label="Cash out" value={formatSom(data.cashOut.total)} />
            <StatCard label="Net cash flow" strong value={formatSom(data.netCashFlow)} />
            <StatCard label="Closing balance" strong value={formatSom(data.closingBalance)} />
            {roi && roi.roiPct !== null && <StatCard hint="Net Profit ÷ total investment" label="ROI (period)" value={`${roi.roiPct}%`} />}
          </StatGrid>
          <ChartContainer description="Cash out, by category." title="Cash outflow breakdown">
            <BarChart
              ariaLabel="Cash outflow"
              data={[
                { label: 'Operating expenses (paid)', value: data.cashOut.operatingExpensesPaid },
                { label: 'Financial expenses (paid)', value: data.cashOut.financialExpensesPaid },
                { label: 'Loan principal', value: data.cashOut.loanPrincipal },
                { label: 'Loan interest', value: data.cashOut.loanInterest },
                { label: 'Investments', value: data.cashOut.investments },
                { label: 'Manual adjustments', value: data.cashOut.manualAdjustments },
              ]}
              format={formatSom}
            />
          </ChartContainer>
          <SectionCard title="What this view does not cover">
            <ul className="text-[13px] leading-snug text-muted m-0 pl-[1.1em]">
              {data.limitations.map((l) => (
                <li key={l} className="mb-1">
                  {l}
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      )}
    </>
  );
}
