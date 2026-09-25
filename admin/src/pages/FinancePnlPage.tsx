import { useState } from 'react';
import { fetchFinanceOverview } from '../lib/adminFinance';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { FinanceCogsBanner } from '../components/FinanceCogsBanner';
import { FinanceFilterBar } from '../components/FinanceFilterBar';
import { FinanceRangeValue, isFinanceRangeReady } from '../components/FinancePeriodPicker';
import { useFinanceData } from '../components/useFinanceData';
import { cx, ErrorState, KeyValue, LoadingState, PageHeader, SectionCard } from '../ui';

const number = (n: number) => n.toLocaleString('ru-RU');

export function FinancePnlPage() {
  const { item } = findNav('finance-pnl');
  const [range, setRange] = useState<FinanceRangeValue>({ period: 'thisMonth', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const ready = isFinanceRangeReady(range);
  const filters = { ...range, branchId: branchId || undefined };

  const { data, error, loading } = useFinanceData(() => fetchFinanceOverview(filters), [filters.period, filters.startDate, filters.endDate, filters.branchId], ready);

  const line = (label: string, value: number, strong?: boolean, negative?: boolean) => ({
    key: label,
    label: <span style={strong ? { fontWeight: 600 } : undefined}>{label}</span>,
    value: <span style={strong ? { fontWeight: 600 } : undefined}>{negative ? `− ${formatSom(value)}` : formatSom(value)}</span>,
  });

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FinanceFilterBar branchId={branchId} onBranchChange={setBranchId} onRangeChange={setRange} range={range} />

      {error && <ErrorState message={error} title="P&L could not be loaded" />}
      {!data && !error && <LoadingState variant="page" />}

      {data && (
        <div className={cx('flex min-w-0 flex-col gap-5 transition-opacity duration-200', loading && 'opacity-60')}>
          <FinanceCogsBanner data={data} />
          <SectionCard description={`${data.period.startDate} → ${data.period.endDate}${data.branch ? ` · ${data.branch.name}` : ' · All branches'}`} title="Profit & Loss statement">
            <KeyValue
              rows={[
                line('Revenue', data.revenue),
                line('COGS', data.cogs.amountMinor, false, true),
                line('Gross Profit', data.grossProfit, true),
                ...data.operatingExpenses.byCategory.map((c) => line(`  ${c.categoryName}`, c.amountMinor, false, true)),
                line('Operating Profit', data.operatingProfit, true),
                ...data.taxes.lines.map((t) => line(`  Tax: ${t.name} (${t.ratePct}% of ${t.calculationBase.toLowerCase().replace('_', ' ')})`, t.amountMinor, false, true)),
                line('Interest', data.interest, false, true),
                ...data.otherFinancialCosts.byCategory.map((c) => line(`  ${c.categoryName}`, c.amountMinor, false, true)),
                line('Net Profit', data.netProfit, true),
              ]}
            />
          </SectionCard>
          {!data.cogs.complete && (
            <SectionCard description="Sold in this period, no Poster recipe configured yet — excluded from COGS above." title="Products with unknown cost">
              <KeyValue rows={data.cogs.missingRecipeProducts.map((p) => ({ key: p.name, label: p.name, value: `×${number(p.quantity)}` }))} />
            </SectionCard>
          )}
        </div>
      )}
    </>
  );
}
