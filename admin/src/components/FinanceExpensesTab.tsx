import { useEffect, useState } from 'react';
import { createExpense, createExpenseCategory, deleteExpense, fetchExpenseCategories, fetchExpenses } from '../lib/adminFinance';
import { ApiError } from '../lib/api';
import { formatDate, formatSom } from '../lib/format';
import { FinanceExpense, FinanceExpenseCategory } from '../lib/types';
import { Button, Column, ConfirmDialog, DataTable, EmptyState, ErrorState, LoadingState, Modal, SectionCard, StatusBadge } from '../ui';

const todayIso = () => new Date().toISOString().slice(0, 10);

export function FinanceExpensesTab() {
  const [categories, setCategories] = useState<FinanceExpenseCategory[] | null>(null);
  const [expenses, setExpenses] = useState<FinanceExpense[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FinanceExpense | null>(null);

  const load = () => {
    setError(null);
    Promise.all([fetchExpenseCategories(), fetchExpenses()])
      .then(([cats, page]) => {
        setCategories(cats);
        setExpenses(page.rows);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load expenses.'));
  };

  useEffect(load, []);

  const handleLoadMore = async () => {
    if (!nextCursor) return;
    const page = await fetchExpenses({ cursor: nextCursor });
    setExpenses((cur) => [...(cur ?? []), ...page.rows]);
    setNextCursor(page.nextCursor);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    await deleteExpense(confirmDelete.id);
    setConfirmDelete(null);
    load();
  };

  const columns: Column<FinanceExpense>[] = [
    { key: 'date', header: 'Date', cell: (e) => formatDate(e.date) },
    { key: 'desc', header: 'Description', cell: (e) => <span className="font-semibold text-black">{e.description}</span> },
    { key: 'cat', header: 'Category', low: true, cell: (e) => e.category.name },
    { key: 'branch', header: 'Branch', low: true, cell: (e) => e.branch?.name ?? 'All' },
    { key: 'status', header: 'Status', cell: (e) => (e.paymentStatus === 'PAID' ? <StatusBadge dot tone="ok">Paid</StatusBadge> : <StatusBadge dot tone="warn">Unpaid</StatusBadge>) },
    { key: 'recurring', header: 'Recurring', low: true, cell: (e) => (e.isRecurring ? 'Monthly' : '—') },
    { key: 'amount', header: 'Amount', numeric: true, cell: (e) => formatSom(e.amountMinor) },
    {
      key: 'actions',
      header: '',
      actions: true,
      cell: (e) => (
        <Button onClick={() => setConfirmDelete(e)} size="sm" variant="secondary">
          Delete
        </Button>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {error && <ErrorState message={error} onRetry={load} title="Expenses could not be loaded" />}
      <SectionCard
        actions={
          <>
            <Button onClick={() => setShowAddCategory(true)} variant="secondary">
              + Category
            </Button>
            <Button onClick={() => setShowAddExpense(true)} variant="primary">
              + Expense
            </Button>
          </>
        }
        description="Every incurred expense — paid or not yet paid. Feeds the P&L for the period it was dated in."
        flush
        footer={
          nextCursor ? (
            <Button onClick={handleLoadMore} variant="secondary">
              Load more
            </Button>
          ) : undefined
        }
        title="Expenses"
      >
        {expenses === null && !error ? (
          <LoadingState variant="table" />
        ) : (
          <DataTable columns={columns} empty={<EmptyState text="No expenses recorded yet." title="No expenses" variant="block" />} rowKey={(e) => e.id} rows={expenses ?? []} />
        )}
      </SectionCard>

      {showAddExpense && categories && (
        <AddExpenseModal categories={categories} onClose={() => setShowAddExpense(false)} onSaved={() => { setShowAddExpense(false); load(); }} />
      )}
      {showAddCategory && <AddCategoryModal onClose={() => setShowAddCategory(false)} onSaved={() => { setShowAddCategory(false); load(); }} />}
      {confirmDelete && (
        <ConfirmDialog
          confirmLabel="Delete"
          message={`${confirmDelete.description} — ${formatSom(confirmDelete.amountMinor)} on ${formatDate(confirmDelete.date)}. This cannot be undone.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
          title="Delete this expense?"
          tone="danger"
        />
      )}
    </div>
  );
}

function AddCategoryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'OPERATING' | 'FINANCIAL'>('OPERATING');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createExpenseCategory({ name: name.trim(), type });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to create category.');
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
            {saving ? 'Saving…' : 'Create category'}
          </Button>
        </>
      }
      onClose={onClose}
      title="New expense category"
    >
      {error && <p className="text-[13px] font-semibold text-err">{error}</p>}
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
        <label htmlFor="cat-name">Name</label>
        <input id="cat-name" onChange={(e) => setName(e.target.value)} value={name} />
      </div>
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
        <label htmlFor="cat-type">Type</label>
        <select id="cat-type" onChange={(e) => setType(e.target.value as 'OPERATING' | 'FINANCIAL')} value={type}>
          <option value="OPERATING">Operating (reduces Operating Profit)</option>
          <option value="FINANCIAL">Financial (bank fees, penalties — reduces Net Profit only)</option>
        </select>
      </div>
    </Modal>
  );
}

function AddExpenseModal({ categories, onClose, onSaved }: { categories: FinanceExpenseCategory[]; onClose: () => void; onSaved: () => void }) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [paymentStatus, setPaymentStatus] = useState<'PAID' | 'UNPAID'>('PAID');
  const [isRecurring, setIsRecurring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const amountMinor = Number(amount);
    if (!categoryId) return setError('Choose a category.');
    if (!description.trim()) return setError('Description is required.');
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) return setError('Enter a valid amount.');
    setSaving(true);
    setError(null);
    try {
      await createExpense({ categoryId, description: description.trim(), amountMinor, date, paymentStatus, isRecurring, recurrenceInterval: isRecurring ? 'MONTHLY' : null });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to create expense.');
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
            {saving ? 'Saving…' : 'Add expense'}
          </Button>
        </>
      }
      onClose={onClose}
      title="New expense"
    >
      {error && <p className="text-[13px] font-semibold text-err">{error}</p>}
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
        <label htmlFor="exp-category">Category</label>
        <select id="exp-category" onChange={(e) => setCategoryId(e.target.value)} value={categoryId}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.type === 'OPERATING' ? 'operating' : 'financial'})
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
        <label htmlFor="exp-desc">Description</label>
        <input id="exp-desc" onChange={(e) => setDescription(e.target.value)} value={description} />
      </div>
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
        <label htmlFor="exp-amount">Amount (so'm)</label>
        <input id="exp-amount" onChange={(e) => setAmount(e.target.value)} type="number" value={amount} />
      </div>
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
        <label htmlFor="exp-date">Date</label>
        <input id="exp-date" onChange={(e) => setDate(e.target.value)} type="date" value={date} />
      </div>
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
        <label htmlFor="exp-status">Payment status</label>
        <select id="exp-status" onChange={(e) => setPaymentStatus(e.target.value as 'PAID' | 'UNPAID')} value={paymentStatus}>
          <option value="PAID">Paid</option>
          <option value="UNPAID">Unpaid</option>
        </select>
      </div>
      <div className="flex flex-row flex-wrap items-center gap-3 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
        <label htmlFor="exp-recurring" className="flex items-center gap-2">
          <input checked={isRecurring} id="exp-recurring" onChange={(e) => setIsRecurring(e.target.checked)} type="checkbox" />
          <span>Repeats monthly (a new row is created automatically each month)</span>
        </label>
      </div>
    </Modal>
  );
}
