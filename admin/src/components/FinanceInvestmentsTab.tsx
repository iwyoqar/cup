import { useEffect, useState } from 'react';
import { createInvestment, deleteInvestment, fetchFinancePayback, fetchInvestments } from '../lib/adminFinance';
import { ApiError } from '../lib/api';
import { formatDate, formatSom } from '../lib/format';
import { FinanceInvestment, FinancePayback } from '../lib/types';
import { Button, Column, ConfirmDialog, DataTable, EmptyState, ErrorState, KeyValue, LoadingState, Modal, SectionCard, StatCard, StatGrid, StatusBadge } from '../ui';

const todayIso = () => new Date().toISOString().slice(0, 10);

const PAYBACK_TONE: Record<FinancePayback['status'], 'ok' | 'warn' | 'err' | 'neutral'> = {
  OK: 'ok',
  NO_INVESTMENT_RECORDED: 'neutral',
  INSUFFICIENT_HISTORY: 'warn',
  NEGATIVE_CASH_FLOW: 'err',
};

export function FinanceInvestmentsTab() {
  const [investments, setInvestments] = useState<FinanceInvestment[] | null>(null);
  const [payback, setPayback] = useState<FinancePayback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FinanceInvestment | null>(null);

  const load = () => {
    setError(null);
    Promise.all([fetchInvestments(), fetchFinancePayback()])
      .then(([inv, pb]) => {
        setInvestments(inv);
        setPayback(pb);
      })
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load investments.'));
  };
  useEffect(load, []);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    await deleteInvestment(confirmDelete.id);
    setConfirmDelete(null);
    load();
  };

  const columns: Column<FinanceInvestment>[] = [
    { key: 'date', header: 'Date', cell: (i) => formatDate(i.date) },
    { key: 'category', header: 'Category', cell: (i) => i.category },
    { key: 'desc', header: 'Description', cell: (i) => <span className="font-semibold text-black">{i.description}</span> },
    { key: 'branch', header: 'Branch', low: true, cell: (i) => i.branch?.name ?? 'All' },
    { key: 'source', header: 'Payment source', low: true, cell: (i) => i.paymentSource ?? '—' },
    { key: 'amount', header: 'Amount', numeric: true, cell: (i) => formatSom(i.amountMinor) },
    {
      key: 'actions',
      header: '',
      actions: true,
      cell: (i) => (
        <Button onClick={() => setConfirmDelete(i)} size="sm" variant="secondary">
          Delete
        </Button>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {error && <ErrorState message={error} onRetry={load} title="Investments could not be loaded" />}

      {payback && (
        <SectionCard description={payback.note} title="Payback">
          <StatGrid>
            <StatCard label="Total investment" value={formatSom(payback.totalInvestmentMinor)} />
            <StatCard label="Cumulative cash flow since" value={formatSom(payback.cumulativeCashFlowMinor)} />
            <StatCard label="Remaining to recover" value={formatSom(payback.remainingInvestmentMinor)} />
            <StatCard hint={<StatusBadge dot tone={PAYBACK_TONE[payback.status]}>{payback.status.replace(/_/g, ' ')}</StatusBadge>} label="Progress" value={payback.paybackProgressPct !== null ? `${payback.paybackProgressPct}%` : '—'} />
          </StatGrid>
          {payback.status === 'OK' && (
            <KeyValue
              rows={[
                { key: 'months', label: 'Estimated payback', value: `${payback.estimatedPaybackMonths} months` },
                { key: 'date', label: 'Estimated payback date', value: payback.estimatedPaybackDate ?? '—' },
              ]}
            />
          )}
        </SectionCard>
      )}

      <SectionCard
        actions={
          <Button onClick={() => setShowAdd(true)} variant="primary">
            + Investment
          </Button>
        }
        description="Initial/capital investment — renovation, equipment, deposit, branding, etc. Never treated as a monthly operating expense."
        flush
        title="Investments"
      >
        {investments === null && !error ? (
          <LoadingState variant="table" />
        ) : (
          <DataTable columns={columns} empty={<EmptyState text="No investment recorded yet." title="No investments" variant="block" />} rowKey={(i) => i.id} rows={investments ?? []} />
        )}
      </SectionCard>

      {showAdd && (
        <AddInvestmentModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          confirmLabel="Delete"
          message={`${confirmDelete.description} — ${formatSom(confirmDelete.amountMinor)} on ${formatDate(confirmDelete.date)}. This cannot be undone.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
          title="Delete this investment?"
          tone="danger"
        />
      )}
    </div>
  );
}

const CATEGORY_SUGGESTIONS = ['renovation', 'furniture', 'bar counter', 'espresso machine', 'grinder', 'refrigerator', 'blender', 'POS', 'cameras', 'air conditioning', 'lighting', 'branding', 'initial inventory', 'deposit', 'documentation', 'other'];

function AddInvestmentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState(CATEGORY_SUGGESTIONS[0]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [paymentSource, setPaymentSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const amountMinor = Number(amount);
    if (!description.trim()) return setError('Description is required.');
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) return setError('Enter a valid amount.');
    setSaving(true);
    setError(null);
    try {
      await createInvestment({ category, description: description.trim(), amountMinor, date, paymentSource: paymentSource.trim() || null });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to create investment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button disabled={saving} onClick={submit} variant="primary">
            {saving ? 'Saving…' : 'Add investment'}
          </Button>
        </>
      }
      onClose={onClose}
      title="New investment"
    >
      {error && <p className="text-[13px] font-semibold text-err">{error}</p>}
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
        <label htmlFor="inv-category">Category</label>
        <select id="inv-category" onChange={(e) => setCategory(e.target.value)} value={category}>
          {CATEGORY_SUGGESTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
        <label htmlFor="inv-desc">Description</label>
        <input id="inv-desc" onChange={(e) => setDescription(e.target.value)} value={description} />
      </div>
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
        <label htmlFor="inv-amount">Amount (so'm)</label>
        <input id="inv-amount" onChange={(e) => setAmount(e.target.value)} type="number" value={amount} />
      </div>
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
        <label htmlFor="inv-date">Date</label>
        <input id="inv-date" onChange={(e) => setDate(e.target.value)} type="date" value={date} />
      </div>
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
        <label htmlFor="inv-source">Payment source (optional)</label>
        <input id="inv-source" onChange={(e) => setPaymentSource(e.target.value)} value={paymentSource} />
      </div>
    </Modal>
  );
}
