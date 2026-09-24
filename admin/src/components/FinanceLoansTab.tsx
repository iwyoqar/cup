import { useEffect, useState } from 'react';
import { createLoan, fetchLoans, recordLoanPayment } from '../lib/adminFinance';
import { ApiError } from '../lib/api';
import { formatDate, formatSom } from '../lib/format';
import { FinanceLoan } from '../lib/types';
import { Column, DataTable, EmptyState, ErrorState, KeyValue, LoadingState, Modal, SectionCard, StatusBadge } from '../ui';

const todayIso = () => new Date().toISOString().slice(0, 10);

export function FinanceLoansTab() {
  const [loans, setLoans] = useState<FinanceLoan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [payFor, setPayFor] = useState<FinanceLoan | null>(null);

  const load = () => {
    setError(null);
    fetchLoans()
      .then(setLoans)
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load loans.'));
  };
  useEffect(load, []);

  const columns: Column<FinanceLoan>[] = [
    { key: 'lender', header: 'Lender', cell: (l) => <span className="table__primary">{l.lender}</span> },
    { key: 'principal', header: 'Principal', numeric: true, cell: (l) => formatSom(l.principalMinor) },
    { key: 'rate', header: 'Rate', low: true, cell: (l) => `${l.annualInterestRatePct}%/yr` },
    { key: 'term', header: 'Term', low: true, cell: (l) => `${l.termMonths} mo` },
    { key: 'outstanding', header: 'Outstanding', numeric: true, cell: (l) => formatSom(l.outstandingPrincipalMinor) },
    { key: 'monthly', header: 'Est. monthly', numeric: true, cell: (l) => formatSom(l.estimatedMonthlyPaymentMinor) },
    { key: 'next', header: 'Next due', low: true, cell: (l) => l.nextEstimatedPaymentDate ?? '—' },
    { key: 'status', header: 'Status', cell: (l) => <StatusBadge dot tone={l.status === 'ACTIVE' ? 'info' : l.status === 'PAID_OFF' ? 'ok' : 'err'}>{l.status.replace('_', ' ')}</StatusBadge> },
    {
      key: 'actions',
      header: '',
      actions: true,
      cell: (l) => (
        <button className="button-secondary button--sm" disabled={l.status !== 'ACTIVE'} onClick={() => setPayFor(l)} type="button">
          Record payment
        </button>
      ),
    },
  ];

  return (
    <div className="stack">
      {error && <ErrorState message={error} onRetry={load} title="Loans could not be loaded" />}
      <SectionCard
        actions={
          <button className="button-primary" onClick={() => setShowAdd(true)} type="button">
            + Loan
          </button>
        }
        description="Principal repayment is a cash-flow item; only interest is an expense — the two are always recorded separately."
        flush
        title="Loans"
      >
        {loans === null && !error ? (
          <LoadingState variant="table" />
        ) : (
          <DataTable columns={columns} empty={<EmptyState text="No loans recorded." title="No loans" variant="block" />} rowKey={(l) => l.id} rows={loans ?? []} />
        )}
      </SectionCard>
      {showAdd && (
        <AddLoanModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {payFor && (
        <RecordPaymentModal
          loan={payFor}
          onClose={() => setPayFor(null)}
          onSaved={() => {
            setPayFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function AddLoanModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [lender, setLender] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [term, setTerm] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const principalMinor = Number(principal);
    const annualInterestRatePct = Number(rate);
    const termMonths = Number(term);
    if (!lender.trim()) return setError('Lender is required.');
    if (!Number.isFinite(principalMinor) || principalMinor <= 0) return setError('Enter a valid principal.');
    if (!Number.isFinite(annualInterestRatePct) || annualInterestRatePct < 0) return setError('Enter a valid interest rate.');
    if (!Number.isInteger(termMonths) || termMonths <= 0) return setError('Enter a valid term in months.');
    setSaving(true);
    setError(null);
    try {
      await createLoan({ lender: lender.trim(), principalMinor, annualInterestRatePct, termMonths, startDate });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to create loan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      footer={
        <>
          <button className="button-secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button-primary" disabled={saving} onClick={submit} type="button">
            {saving ? 'Saving…' : 'Create loan'}
          </button>
        </>
      }
      onClose={onClose}
      title="New loan"
    >
      {error && <p className="error-text">{error}</p>}
      <div className="field">
        <label htmlFor="loan-lender">Lender</label>
        <input id="loan-lender" onChange={(e) => setLender(e.target.value)} value={lender} />
      </div>
      <div className="field">
        <label htmlFor="loan-principal">Principal (so'm)</label>
        <input id="loan-principal" onChange={(e) => setPrincipal(e.target.value)} type="number" value={principal} />
      </div>
      <div className="field">
        <label htmlFor="loan-rate">Annual interest rate (%)</label>
        <input id="loan-rate" onChange={(e) => setRate(e.target.value)} type="number" value={rate} />
      </div>
      <div className="field">
        <label htmlFor="loan-term">Term (months)</label>
        <input id="loan-term" onChange={(e) => setTerm(e.target.value)} type="number" value={term} />
      </div>
      <div className="field">
        <label htmlFor="loan-start">Start date</label>
        <input id="loan-start" onChange={(e) => setStartDate(e.target.value)} type="date" value={startDate} />
      </div>
    </Modal>
  );
}

function RecordPaymentModal({ loan, onClose, onSaved }: { loan: FinanceLoan; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [principal, setPrincipal] = useState(String(Math.round(Math.max(0, loan.estimatedMonthlyPaymentMinor - (loan.outstandingPrincipalMinor * loan.annualInterestRatePct) / 100 / 12))));
  const [interest, setInterest] = useState(String(Math.round((loan.outstandingPrincipalMinor * loan.annualInterestRatePct) / 100 / 12)));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const principalMinor = Number(principal);
    const interestMinor = Number(interest);
    if (!Number.isFinite(principalMinor) || principalMinor < 0) return setError('Enter a valid principal amount.');
    if (!Number.isFinite(interestMinor) || interestMinor < 0) return setError('Enter a valid interest amount.');
    if (principalMinor > loan.outstandingPrincipalMinor) return setError(`Principal cannot exceed the outstanding balance (${formatSom(loan.outstandingPrincipalMinor)}).`);
    setSaving(true);
    setError(null);
    try {
      await recordLoanPayment(loan.id, { date, principalMinor, interestMinor });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to record payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      footer={
        <>
          <button className="button-secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button-primary" disabled={saving} onClick={submit} type="button">
            {saving ? 'Saving…' : 'Record payment'}
          </button>
        </>
      }
      onClose={onClose}
      title={`Record a payment — ${loan.lender}`}
    >
      <KeyValue rows={[{ key: 'out', label: 'Outstanding principal', value: formatSom(loan.outstandingPrincipalMinor) }]} />
      {error && <p className="error-text">{error}</p>}
      <div className="field">
        <label htmlFor="pay-date">Date</label>
        <input id="pay-date" onChange={(e) => setDate(e.target.value)} type="date" value={date} />
      </div>
      <div className="field">
        <label htmlFor="pay-principal">Principal portion (so'm) — cash-flow item</label>
        <input id="pay-principal" onChange={(e) => setPrincipal(e.target.value)} type="number" value={principal} />
      </div>
      <div className="field">
        <label htmlFor="pay-interest">Interest portion (so'm) — P&L expense</label>
        <input id="pay-interest" onChange={(e) => setInterest(e.target.value)} type="number" value={interest} />
      </div>
    </Modal>
  );
}
