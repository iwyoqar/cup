import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BranchOption, createStaff, fetchBranchOptions, fetchStaff, updateStaff } from '../lib/adminStaff';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import { findNav } from '../lib/nav';
import { StaffMember } from '../lib/types';
import { Button, Column, ConfirmDialog, DataTable, EmptyState, ErrorState, FilterBar, LoadingState, Modal, PageHeader, SearchInput, SectionCard, StatusBadge } from '../ui';

// Staff accounts are NOT admins: baristas sign in at the separate Staff Panel and can only identify customers. There is no public signup — an account exists only
// if it is created here. The table is ready for Poster-originated staff (a "Poster identity" column appears as soon as the API returns one); until then the
// Poster sync action is shown disabled rather than pretending to work.
export function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<StaffMember | null>(null);
  const [deactivateFor, setDeactivateFor] = useState<StaffMember | null>(null);
  const { item } = findNav('staff');

  const load = () =>
    fetchStaff()
      .then(setStaff)
      .catch((err) => setError(errorMessage(err, 'Failed to load staff.')));

  useEffect(() => {
    void load();
    fetchBranchOptions().then(setBranches).catch(() => setBranches([]));
  }, []);

  const toggleActive = async (member: StaffMember) => {
    setError(null);
    try {
      await updateStaff(member.id, { isActive: !member.isActive });
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Failed to update the account.'));
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (staff ?? []).filter((m) => !q || m.username.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q) || (m.branch?.name ?? '').toLowerCase().includes(q));
  }, [staff, query]);

  const hasPosterIdentity = (staff ?? []).some((m) => m.posterUserId !== undefined && m.posterUserId !== null);

  const columns: Column<StaffMember>[] = [
    {
      key: 'name',
      header: 'Staff member',
      cell: (m) => (
        <>
          <span className="font-semibold text-black">{m.displayName}</span>
          <span className="mt-0.5 block text-xs font-normal text-muted">@{m.username}</span>
        </>
      ),
    },
    { key: 'branch', header: 'Branch', low: true, cell: (m) => m.branch?.name ?? <span className="text-[13px] leading-snug text-muted">Not assigned</span> },
    ...(hasPosterIdentity ? [{ key: 'poster', header: 'Poster identity', low: true, cell: (m: StaffMember) => (m.posterUserId ? `Poster #${m.posterUserId}` : '—') }] : []),
    { key: 'access', header: 'CUP access', cell: (m) => (m.isActive ? <StatusBadge dot tone="ok">Active</StatusBadge> : <StatusBadge dot>Deactivated</StatusBadge>) },
    { key: 'created', header: 'Created', low: true, cell: (m) => formatDate(m.createdAt) },
    {
      key: 'actions',
      header: '',
      actions: true,
      cell: (m) => (
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <Button onClick={() => (m.isActive ? setDeactivateFor(m) : void toggleActive(m))} size="sm" variant="secondary">
            {m.isActive ? 'Deactivate' : 'Activate'}
          </Button>
          <Button onClick={() => setResetFor(m)} size="sm" variant="secondary">
            Reset password
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        actions={
          <>
            <Button disabled title="The Admin API cannot import staff from Poster yet" variant="secondary">
              Sync from Poster
            </Button>
            <Button onClick={() => setCreating(true)} variant="primary">
              + New staff account
            </Button>
          </>
        }
        description={item.description}
        title={item.label}
      />

      {error && <ErrorState message={error} title="Staff could not be updated" />}
      {notice && <div className="block space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed [&_p]:m-0 border-ok bg-ok-bg text-ok">{notice}</div>}

      <FilterBar>
        <SearchInput label="Search staff" onChange={setQuery} placeholder="Search name, username or branch" value={query} />
      </FilterBar>

      <SectionCard description="Baristas sign in at the Staff Panel with these accounts. They can identify customers and see loyalty progress — nothing else." flush title="Accounts">
        {staff === null && !error ? (
          <LoadingState variant="table" />
        ) : (
          <DataTable
            columns={columns}
            empty={
              <EmptyState
                action={
                  !query && (
                    <Button onClick={() => setCreating(true)} variant="primary">
                      + New staff account
                    </Button>
                  )
                }
                text={query ? 'No account matches this search.' : 'Create an account for each barista who will use the Staff Panel.'}
                title={query ? 'No staff found' : 'No staff accounts yet'}
                variant="block"
              />
            }
            rowKey={(m) => m.id}
            rows={visible}
          />
        )}
      </SectionCard>

      {creating && (
        <CreateStaffModal
          branches={branches}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            setNotice('Staff account created.');
            await load();
          }}
        />
      )}
      {resetFor && (
        <ResetPasswordModal
          member={resetFor}
          onClose={() => setResetFor(null)}
          onDone={() => {
            setNotice(`Password updated for ${resetFor.username}.`);
            setResetFor(null);
          }}
        />
      )}
      {deactivateFor && (
        <ConfirmDialog
          confirmLabel="Deactivate"
          message={`${deactivateFor.displayName} (@${deactivateFor.username}) will no longer be able to sign in to the Staff Panel. You can activate the account again at any time.`}
          onCancel={() => setDeactivateFor(null)}
          onConfirm={async () => {
            const member = deactivateFor;
            setDeactivateFor(null);
            await toggleActive(member);
          }}
          tone="danger"
          title="Deactivate this account?"
        />
      )}
    </>
  );
}

function CreateStaffModal({ branches, onClose, onCreated }: { branches: BranchOption[]; onClose: () => void; onCreated: () => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createStaff({ username, displayName, password, branchId: branchId || null });
      await onCreated();
    } catch (err) {
      setError(errorMessage(err, 'Failed to create the account.'));
      setBusy(false);
    }
  };

  return (
    <Modal
      dismissible={!busy}
      footer={
        <>
          <Button disabled={busy} onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button disabled={busy || !username || !displayName || password.length < 8} form="staff-create-form" type="submit" variant="primary">
            {busy ? 'Creating…' : 'Create account'}
          </Button>
        </>
      }
      onClose={onClose}
      title="New staff account"
    >
      <form className="flex min-w-0 flex-col gap-5" id="staff-create-form" onSubmit={submit}>
        <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
          <label htmlFor="staff-username">Username</label>
          <input autoComplete="off" id="staff-username" onChange={(e) => setUsername(e.target.value)} value={username} />
        </div>
        <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
          <label htmlFor="staff-name">Display name</label>
          <input id="staff-name" onChange={(e) => setDisplayName(e.target.value)} value={displayName} />
        </div>
        <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
          <label htmlFor="staff-password">Password (min 8 characters)</label>
          <input autoComplete="new-password" id="staff-password" onChange={(e) => setPassword(e.target.value)} type="password" value={password} />
        </div>
        <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
          <label htmlFor="staff-branch">Branch</label>
          <select id="staff-branch" onChange={(e) => setBranchId(e.target.value)} value={branchId}>
            <option value="">Not assigned</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-[13px] font-semibold text-err">{error}</p>}
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ member, onClose, onDone }: { member: StaffMember; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateStaff(member.id, { password });
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'Failed to update the password.'));
      setBusy(false);
    }
  };

  return (
    <Modal
      dismissible={!busy}
      footer={
        <>
          <Button disabled={busy} onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button disabled={busy || password.length < 8} form="staff-reset-form" type="submit" variant="primary">
            {busy ? 'Saving…' : 'Set password'}
          </Button>
        </>
      }
      onClose={onClose}
      title={`New password for @${member.username}`}
    >
      <form className="flex min-w-0 flex-col gap-5" id="staff-reset-form" onSubmit={submit}>
        <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
          <label htmlFor="staff-new-password">New password (min 8 characters)</label>
          <input autoComplete="new-password" autoFocus id="staff-new-password" onChange={(e) => setPassword(e.target.value)} type="password" value={password} />
        </div>
        {error && <p className="text-[13px] font-semibold text-err">{error}</p>}
      </form>
    </Modal>
  );
}
