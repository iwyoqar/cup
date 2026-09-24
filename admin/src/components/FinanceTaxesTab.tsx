import { useEffect, useState } from 'react';
import { createTaxRule, fetchTaxRules, updateTaxRule } from '../lib/adminFinance';
import { ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { FinanceTaxRule } from '../lib/types';
import { Column, DataTable, EmptyState, ErrorState, LoadingState, Modal, SectionCard, StatusBadge } from '../ui';

const todayIso = () => new Date().toISOString().slice(0, 10);
const BASE_LABEL: Record<string, string> = { REVENUE: 'Revenue', GROSS_PROFIT: 'Gross Profit', OPERATING_PROFIT: 'Operating Profit' };

// This is an accounting calculation engine, not legal advice — the exact Uzbek tax treatment is
// left fully configurable, never assumed. See finance-tax.service.ts's own comment.
export function FinanceTaxesTab() {
  const [rules, setRules] = useState<FinanceTaxRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = () => {
    setError(null);
    fetchTaxRules()
      .then(setRules)
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load tax rules.'));
  };
  useEffect(load, []);

  const toggleActive = async (rule: FinanceTaxRule) => {
    await updateTaxRule(rule.id, { isActive: !rule.isActive });
    load();
  };

  const columns: Column<FinanceTaxRule>[] = [
    { key: 'name', header: 'Name', cell: (r) => <span className="table__primary">{r.name}</span> },
    { key: 'rate', header: 'Rate', numeric: true, cell: (r) => `${r.ratePct}%` },
    { key: 'base', header: 'Applied to', low: true, cell: (r) => BASE_LABEL[r.calculationBase] ?? r.calculationBase },
    { key: 'from', header: 'Effective from', low: true, cell: (r) => formatDate(r.effectiveFrom) },
    { key: 'to', header: 'Effective to', low: true, cell: (r) => (r.effectiveTo ? formatDate(r.effectiveTo) : 'ongoing') },
    { key: 'status', header: 'Status', cell: (r) => (r.isActive ? <StatusBadge dot tone="ok">Active</StatusBadge> : <StatusBadge dot>Inactive</StatusBadge>) },
    {
      key: 'actions',
      header: '',
      actions: true,
      cell: (r) => (
        <button className="button-secondary button--sm" onClick={() => toggleActive(r)} type="button">
          {r.isActive ? 'Deactivate' : 'Activate'}
        </button>
      ),
    },
  ];

  return (
    <div className="stack">
      {error && <ErrorState message={error} onRetry={load} title="Tax rules could not be loaded" />}
      <SectionCard
        actions={
          <button className="button-primary" onClick={() => setShowAdd(true)} type="button">
            + Tax rule
          </button>
        }
        description="Configurable, transparent tax rules applied to Revenue, Gross Profit, or Operating Profit — never a hardcoded rate."
        flush
        title="Tax rules"
      >
        {rules === null && !error ? (
          <LoadingState variant="table" />
        ) : (
          <DataTable columns={columns} empty={<EmptyState text="No tax rules configured." title="No tax rules" variant="block" />} rowKey={(r) => r.id} rows={rules ?? []} />
        )}
      </SectionCard>
      {showAdd && (
        <AddTaxRuleModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function AddTaxRuleModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [base, setBase] = useState<'REVENUE' | 'GROSS_PROFIT' | 'OPERATING_PROFIT'>('REVENUE');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const ratePct = Number(rate);
    if (!name.trim()) return setError('Name is required.');
    if (!Number.isFinite(ratePct) || ratePct < 0) return setError('Enter a valid rate.');
    setSaving(true);
    setError(null);
    try {
      await createTaxRule({ name: name.trim(), ratePct, calculationBase: base, effectiveFrom });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to create tax rule.');
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
            {saving ? 'Saving…' : 'Create tax rule'}
          </button>
        </>
      }
      onClose={onClose}
      title="New tax rule"
    >
      {error && <p className="error-text">{error}</p>}
      <div className="field">
        <label htmlFor="tax-name">Name</label>
        <input id="tax-name" onChange={(e) => setName(e.target.value)} value={name} />
      </div>
      <div className="field">
        <label htmlFor="tax-rate">Rate (%)</label>
        <input id="tax-rate" onChange={(e) => setRate(e.target.value)} type="number" value={rate} />
      </div>
      <div className="field">
        <label htmlFor="tax-base">Applied to</label>
        <select id="tax-base" onChange={(e) => setBase(e.target.value as typeof base)} value={base}>
          <option value="REVENUE">Revenue</option>
          <option value="GROSS_PROFIT">Gross Profit</option>
          <option value="OPERATING_PROFIT">Operating Profit</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="tax-from">Effective from</label>
        <input id="tax-from" onChange={(e) => setEffectiveFrom(e.target.value)} type="date" value={effectiveFrom} />
      </div>
    </Modal>
  );
}
