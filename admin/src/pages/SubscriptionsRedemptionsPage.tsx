import { useEffect, useState } from 'react';
import { errorText, REDEMPTION_STATUSES, RedemptionDetail, RedemptionRow, RedemptionsPage, subscriptionsApi, useSubscriptionsGet } from '../lib/adminSubscriptions';
import { formatDateTime } from '../lib/format';
import { findNav } from '../lib/nav';
import { rangeParams } from '../lib/useReport';
import { Button, Column, DataTable, DateRangePicker, DateRangeValue, Drawer, EmptyState, FilterBar, FilterField, Input, isRangeReady, KeyValue, LoadingState, PageHeader, Pagination, SearchInput, SectionCard, Select, useToast } from '../ui';
import { num, PeriodHint, ReportBody } from './reportsShared';
import { businessDate, CustomerCell, failureText, StatusPill } from './subscriptionsShared';

const columns: Column<RedemptionRow>[] = [
  { key: 'd', header: 'Date / time', cell: (r) => formatDateTime(r.at) },
  { key: 'c', header: 'Customer', cell: (r) => <CustomerCell c={r.customer} /> },
  { key: 'p', header: 'Plan', low: true, cell: (r) => r.planName },
  { key: 'dr', header: 'Drink', cell: (r) => r.productName },
  { key: 'po', header: 'Portions', numeric: true, cell: (r) => `−${r.portionCost}` },
  { key: 'b', header: 'Branch', low: true, cell: (r) => r.branchName ?? '—' },
  { key: 'tx', header: 'Poster receipt', low: true, cell: (r) => (r.posterTransactionId ? `#${r.posterTransactionId}` : '—') },
  { key: 's', header: 'Status', cell: (r) => <span className="flex flex-col items-start gap-0.5"><StatusPill status={r.status} />{r.status === 'FAILED' && <span className="text-xs text-muted">{failureText(r.failureReason)}</span>}{r.reconciliationStatus === 'LINE_MISSING' && <span className="text-xs font-semibold text-err">Line missing on receipt</span>}</span> },
];

export function SubscriptionsRedemptionsPage() {
  const { item } = findNav('subscriptions-redemptions');
  const [range, setRange] = useState<DateRangeValue>({ period: 'last7', startDate: '', endDate: '' });
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [planId, setPlanId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [productId, setProductId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const ready = isRangeReady(range);
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => setPage(1), [range, q, planId, branchId, productId, status]);
  const { data, error, loading, reload } = useSubscriptionsGet<RedemptionsPage>('/redemptions', { ...rangeParams(range), q, planId, branchId, productId, status, page }, ready);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <SearchInput label="Customer" onChange={setSearchInput} placeholder="Name, CUP code or phone" value={searchInput} />
        <FilterField label="Plan">
          <Select onChange={(e) => setPlanId(e.target.value)} value={planId}>
            <option value="">All</option>
            {(data?.filters.plans ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Branch">
          <Select onChange={(e) => setBranchId(e.target.value)} value={branchId}>
            <option value="">All</option>
            {(data?.filters.branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Drink">
          <Select onChange={(e) => setProductId(e.target.value)} value={productId}>
            <option value="">All</option>
            {(data?.filters.products ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Status">
          <Select onChange={(e) => setStatus(e.target.value)} value={status}>
            <option value="">All</option>
            {REDEMPTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </Select>
        </FilterField>
        <PeriodHint loading={loading} period={data?.period} />
      </FilterBar>
      <ReportBody data={data} error={error} loading={loading} ready={ready} reload={reload} title="Redemptions could not be loaded">
        {(d) => (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              {d.byStatus.map((s) => (
                <span className="rounded-full bg-neutral-bg px-3 py-1 font-semibold text-muted-cream" key={s.status}>
                  {s.status.toLowerCase()}: {num(s.count)} · {num(s.portions)} portion(s)
                </span>
              ))}
            </div>
            <SectionCard description={`${num(d.total)} attempt(s). Only CONFIRMED rows consumed portions; UNKNOWN rows hold them until reconciled.`} flush title="Redemptions">
              <DataTable columns={columns} empty={<EmptyState text="No subscription redemption in this period." title="Nothing here" variant="inline" />} onRowClick={(r) => setSelected(r.id)} rowKey={(r) => r.id} rows={d.items} />
              <div className="px-5 py-3">
                <Pagination busy={loading} onPage={setPage} page={d.page} pages={d.pages} total={d.total} />
              </div>
            </SectionCard>
          </>
        )}
      </ReportBody>
      {selected && <RedemptionDrawer id={selected} onChanged={reload} onClose={() => setSelected(null)} />}
    </>
  );
}

function RedemptionDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<RedemptionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    subscriptionsApi.redemption(id).then(setD).catch((err) => setError(errorText(err)));
  }, [id]);

  const resolve = async (outcome: 'CONFIRMED' | 'FAILED') => {
    setBusy(true);
    try {
      setD(await subscriptionsApi.resolveRedemption(id, outcome, note.trim()));
      toast({ tone: 'success', title: outcome === 'CONFIRMED' ? 'Marked as given (portions consumed)' : 'Marked as not given (portions released)' });
      onChanged();
    } catch (err) {
      toast({ tone: 'error', title: 'Could not resolve', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer onClose={onClose} title="Subscription redemption">
      {error ? (
        <p className="text-sm text-err">{error}</p>
      ) : !d ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col gap-5">
          <KeyValue
            rows={[
              { key: 's', label: 'Status', value: <StatusPill status={d.status} /> },
              { key: 'f', label: 'Failure reason', value: failureText(d.failureReason) },
              { key: 'c', label: 'Customer', value: d.customer.name ?? '—' },
              { key: 'dr', label: 'Drink', value: `${d.productName} (Poster #${d.posterProductId})` },
              { key: 'po', label: 'Portions', value: d.portionCost },
              { key: 'pl', label: 'Subscription', value: `${d.subscription.planName} · ${businessDate(d.subscription.startBusinessDate)} → ${businessDate(d.subscription.endBusinessDate)}` },
              { key: 'b', label: 'Branch', value: d.branchName ?? '—' },
              { key: 'rq', label: 'Requested', value: formatDateTime(d.requestedAt) },
              { key: 'rd', label: 'Redeemed', value: d.redeemedAt ? formatDateTime(d.redeemedAt) : '—' },
              { key: 'bd', label: 'Business date', value: d.businessDate },
              { key: 'po2', label: 'Poster order (register id)', value: d.posterOrderId },
              { key: 'tx', label: 'Poster receipt', value: d.posterTransactionId ? `#${d.posterTransactionId}` : '—' },
              { key: 'tl', label: 'Poster line', value: d.posterTransactionProductId ?? '—' },
              { key: 'rc', label: 'Receipt reconciliation', value: d.reconciliationStatus ?? 'not yet (receipt still open or not imported)' },
              { key: 'sp', label: 'Spot / register', value: `${d.posterSpotId ?? '—'} / ${d.posterTabletId ?? '—'}` },
              { key: 'em', label: 'Poster employee', value: d.employeeIdentifier ?? '—' },
              { key: 'at', label: 'Attempt id', value: <span className="font-mono text-xs">{d.attemptId}</span> },
              { key: 'cs', label: 'Claim sequence', value: d.claimSequence ?? '—' },
              { key: 'rb', label: 'Resolved by', value: d.resolvedBy ? `${d.resolvedBy}${d.resolutionNote ? ` — ${d.resolutionNote}` : ''}` : '—' },
            ]}
          />
          {d.status === 'UNKNOWN' && (
            <SectionCard description="Poster's answer was ambiguous, so the portions are held (not consumed, not released). Check the receipt on the register, then decide. The importer also resolves this automatically once the receipt closes." title="Resolve">
              <div className="flex flex-col gap-2">
                <Input onChange={(e) => setNote(e.target.value)} placeholder="What did you check?" value={note} />
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy || note.trim().length < 3} onClick={() => void resolve('CONFIRMED')} variant="primary">
                    The drink WAS given
                  </Button>
                  <Button disabled={busy || note.trim().length < 3} onClick={() => void resolve('FAILED')} variant="secondary">
                    Not given — release portions
                  </Button>
                </div>
              </div>
            </SectionCard>
          )}
        </div>
      )}
    </Drawer>
  );
}
