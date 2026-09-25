import { useState } from 'react';
import { formatDate, formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { ReportsTaxesOverview } from '../lib/reportsTypes';
import { rangeParams, useReport } from '../lib/useReport';
import { Column, DataTable, DateRangePicker, DateRangeValue, EmptyState, FilterBar, isRangeReady, PageHeader, SectionCard, StatCard, StatGrid, StatusBadge } from '../ui';
import { BranchSelect, Notes, num, PeriodHint, ReportBody } from './reportsShared';

type PosterTax = ReportsTaxesOverview['poster']['taxes'][number];
type CupRule = ReportsTaxesOverview['cup']['rules'][number];

const BASE_LABEL: Record<string, string> = { REVENUE: 'Revenue', GROSS_PROFIT: 'Gross profit', OPERATING_PROFIT: 'Operating profit' };
const REASON_LABEL: Record<string, string> = { INACTIVE: 'Rule inactive', NOT_IN_EFFECT: 'Not in effect in this period', PARTIAL_PERIOD_NOT_PRORATED: 'Only partly in effect — not prorated' };

const posterColumns: Column<PosterTax>[] = [
  { key: 'n', header: 'Tax', cell: (t) => <span className="font-semibold text-black">{t.name}</span> },
  { key: 't', header: 'Type', cell: (t) => t.typeLabel ?? '—' },
  { key: 'r', header: 'Rate', numeric: true, cell: (t) => (t.ratePercent === null ? '—' : `${t.ratePercent}%`) },
  { key: 'f', header: 'Fiscal', low: true, cell: (t) => (t.fiscal === null ? '—' : t.fiscal ? 'Yes' : 'No') },
  { key: 'd', header: 'Poster "delete" flag', low: true, cell: (t) => t.rawDeleteFlag ?? '—' },
  { key: 's', header: 'Source', low: true, cell: () => 'Poster POS' },
];

const cupColumns: Column<CupRule>[] = [
  { key: 'n', header: 'Rule', cell: (r) => <span className="font-semibold text-black">{r.name}</span> },
  { key: 'r', header: 'Rate', numeric: true, cell: (r) => `${r.ratePct}%` },
  { key: 'b', header: 'Tax base', cell: (r) => BASE_LABEL[r.calculationBase] ?? r.calculationBase },
  { key: 'ba', header: 'Base amount', numeric: true, low: true, cell: (r) => (r.baseAmountMinor === null ? '—' : formatSom(r.baseAmountMinor)) },
  { key: 'l', header: 'Calculated liability', numeric: true, cell: (r) => (r.liabilityMinor === null ? '—' : formatSom(r.liabilityMinor)) },
  { key: 'p', header: 'Effective period', low: true, cell: (r) => `${formatDate(r.effectiveFrom)} – ${r.effectiveTo ? formatDate(r.effectiveTo) : 'open'}` },
  { key: 's', header: 'Applied', cell: (r) => (r.applied ? 'Yes' : REASON_LABEL[r.notAppliedReason ?? ''] ?? 'No') },
];

// Taxes — two sources side by side, never merged or subtracted: Poster's configured taxes (Poster POS) and the
// liability CUP Finance calculates from its tax rules (the same number the Finance P&L shows). Nothing is "tax paid".
export function ReportsTaxesPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last30', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const ready = isRangeReady(range);
  const { item } = findNav('reports-taxes');
  const { data, error, loading, reload } = useReport<ReportsTaxesOverview>('taxes', { ...rangeParams(range), branchId }, ready);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <BranchSelect branches={data?.filters.branches ?? []} onChange={setBranchId} value={branchId} />
        <PeriodHint loading={loading} period={data?.period} />
      </FilterBar>

      <ReportBody data={data} error={error} loading={loading} ready={ready} reload={reload} title="Taxes could not be loaded">
        {(d) => (
          <>
            <StatGrid>
              <StatCard hint="finance.getTaxes lists taxes, not amounts" label="Poster tax total" value="Not reported" />
              <StatCard hint="CUP Finance, from tax rules" label="CUP calculated liability" strong value={formatSom(d.cup.calculatedLiabilityMinor)} />
              <StatCard hint={`${num(d.cup.appliedRules)} applied to this period`} label="Active tax rules" value={num(d.cup.activeRules)} />
              <StatCard hint="No tax-payment ledger in CUP" label="Tax paid" value="Not tracked" />
            </StatGrid>

            <SectionCard actions={<StatusBadge>Poster POS</StatusBadge>} description="Taxes configured in Poster (name, rate, type). Poster's tax list has no period and no amounts." flush title="Poster tax configuration">
              {d.poster.available ? (
                <DataTable columns={posterColumns} empty={<EmptyState text="Poster has no taxes configured." title="No taxes reported by Poster" variant="inline" />} rowKey={(t) => t.taxId} rows={d.poster.taxes} />
              ) : (
                <EmptyState text={d.poster.unavailableReason === 'malformed_response' ? 'Poster returned a tax list CUP could not read reliably.' : 'Poster could not be reached. This is not the same as "no taxes".'} title="Poster tax report unavailable." variant="inline" />
              )}
            </SectionCard>

            <SectionCard actions={<StatusBadge>CUP Finance</StatusBadge>} description={`Calculated tax liability from CUP Finance tax rules — the same calculation as Finance → P&L. ${d.cup.scopeNote}`} flush title="CUP Finance tax liability">
              <DataTable columns={cupColumns} empty={<EmptyState text="No tax rules are configured in CUP Finance." title="No tax rules" variant="inline" />} rowKey={(r) => r.ruleId} rows={d.cup.rules} />
            </SectionCard>

            <Notes notes={d.notes} />
          </>
        )}
      </ReportBody>
    </>
  );
}
