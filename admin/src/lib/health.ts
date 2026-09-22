import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { HealthState } from '../ui/StatusBadge';
import { fetchSyncStatus, SyncStatus } from './adminPosterImport';
import { ApiError } from './api';
import { formatAgo } from './format';
import type { AdminPage } from './nav';

// The Admin's view of "is CUP healthy?". It is built ONLY from what the API already exposes — the public GET /health and the admin
// GET /admin/poster/sync-status. Anything the API cannot tell us stays "unknown" with the reason written next to it: this module never
// invents a status.

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string).replace(/\/+$/, '');

export interface SystemPulse {
  loading: boolean;
  backendOk: boolean | null;
  sync: SyncStatus | null;
  syncError: string | null;
  checkedAt: Date | null;
}

const INITIAL: SystemPulse = { loading: true, backendOk: null, sync: null, syncError: null, checkedAt: null };

async function probeBackend(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, { headers: { Accept: 'application/json' } });
    return res.ok;
  } catch {
    return false;
  }
}

export function useSystemPulse(intervalMs = 60_000): SystemPulse & { reload: () => void } {
  const [pulse, setPulse] = useState<SystemPulse>(INITIAL);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const [backendOk, syncResult] = await Promise.all([
        probeBackend(),
        fetchSyncStatus().then(
          (sync) => ({ sync, error: null as string | null }),
          (err: unknown) => ({ sync: null as SyncStatus | null, error: err instanceof ApiError ? err.backendMessage : 'Could not read the sync status.' }),
        ),
      ]);
      if (cancelled) return;
      setPulse({ loading: false, backendOk, sync: syncResult.sync, syncError: syncResult.error, checkedAt: new Date() });
    };
    void run();
    const id = window.setInterval(() => void run(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [intervalMs, tick]);

  return { ...pulse, reload };
}

// The shell owns the one status poll and shares it, so the sidebar, Dashboard and System Health never each ask the backend separately.
export const PulseContext = createContext<(SystemPulse & { reload: () => void }) | null>(null);
export function usePulse(): SystemPulse & { reload: () => void } {
  const value = useContext(PulseContext);
  if (!value) throw new Error('usePulse must be used inside <AdminShell>.');
  return value;
}

export interface HealthItem {
  id: string;
  name: string;
  state: HealthState;
  detail: string;
}

// Reconciliation is due every `reconcileMinutes`; more than three intervals without a success is worth a warning (same rule the backend alerts use).
function reconcileStale(sync: SyncStatus): boolean {
  const last = sync.reconciliation.lastSuccessAt;
  if (!last) return false;
  return Date.now() - new Date(last).getTime() > sync.config.reconcileMinutes * 60_000 * 3;
}

export function deriveHealth(p: SystemPulse): HealthItem[] {
  const sync = p.sync;
  const items: HealthItem[] = [];

  items.push(
    p.backendOk === null
      ? { id: 'backend', name: 'Backend', state: 'unknown', detail: 'Checking…' }
      : p.backendOk
        ? { id: 'backend', name: 'Backend', state: 'healthy', detail: 'The API answers its health check.' }
        : { id: 'backend', name: 'Backend', state: 'error', detail: 'The API did not answer its health check.' },
  );

  items.push(
    sync
      ? { id: 'database', name: 'Database', state: 'healthy', detail: 'Queries succeed (the sync status was read from it).' }
      : { id: 'database', name: 'Database', state: 'unknown', detail: p.syncError ? `Could not confirm: ${p.syncError}` : 'Could not be confirmed yet.' },
  );

  if (!sync) {
    items.push({ id: 'poster', name: 'Poster', state: 'unknown', detail: 'Sync status unavailable.' });
    items.push({ id: 'webhooks', name: 'Webhooks', state: 'unknown', detail: 'Sync status unavailable.' });
    items.push({ id: 'sync', name: 'Continuous sync', state: 'unknown', detail: 'Sync status unavailable.' });
  } else {
    const rec = sync.reconciliation;
    const posterErr = rec.lastError && !rec.lastError.resolved ? rec.lastError : null;
    items.push(
      posterErr
        ? { id: 'poster', name: 'Poster', state: 'error', detail: `The last Poster check failed ${formatAgo(posterErr.at)}: ${posterErr.message}` }
        : !rec.lastSuccessAt
          ? { id: 'poster', name: 'Poster', state: 'unknown', detail: 'No successful Poster check has run yet.' }
          : reconcileStale(sync)
            ? { id: 'poster', name: 'Poster', state: 'warning', detail: `Last successful check ${formatAgo(rec.lastSuccessAt)} — later than expected.` }
            : { id: 'poster', name: 'Poster', state: 'healthy', detail: `Last successful check ${formatAgo(rec.lastSuccessAt)}.` },
    );

    const wh = sync.webhooks;
    items.push(
      !sync.config.applicationSecretConfigured
        ? { id: 'webhooks', name: 'Webhooks', state: 'warning', detail: 'The Poster application secret is not configured, so the webhook route rejects every call.' }
        : wh.rejectedSinceStart > 0
          ? { id: 'webhooks', name: 'Webhooks', state: 'warning', detail: `${wh.rejectedSinceStart} webhook call(s) were rejected since the backend started (bad signature or account).` }
          : !wh.lastReceivedAt
            ? { id: 'webhooks', name: 'Webhooks', state: 'unknown', detail: 'No webhook has been received yet.' }
            : wh.received24h === 0
              ? { id: 'webhooks', name: 'Webhooks', state: 'warning', detail: `None in the last 24 h. Last received ${formatAgo(wh.lastReceivedAt)}.` }
              : { id: 'webhooks', name: 'Webhooks', state: 'healthy', detail: `${wh.received24h} received in the last 24 h. Last ${formatAgo(wh.lastReceivedAt)}.` },
    );

    const q = sync.queue;
    items.push(
      !sync.config.syncEnabled
        ? { id: 'sync', name: 'Continuous sync', state: 'unknown', detail: 'Automatic import is OFF (POSTER_SYNC_ENABLED).' }
        : q.dead > 0
          ? { id: 'sync', name: 'Continuous sync', state: 'error', detail: `${q.dead} event(s) failed for good and need a manual retry.` }
          : sync.alerts.length > 0
            ? { id: 'sync', name: 'Continuous sync', state: 'warning', detail: sync.alerts[0] + (sync.alerts.length > 1 ? ` (+${sync.alerts.length - 1} more)` : '') }
            : { id: 'sync', name: 'Continuous sync', state: 'healthy', detail: q.queued + q.processing === 0 ? 'Automatic import is ON. The queue is empty.' : `Automatic import is ON. ${q.queued + q.processing} event(s) in progress.` },
    );
  }

  items.push({ id: 'telegram', name: 'Telegram', state: 'unknown', detail: 'The API exposes no Telegram health check to the Admin yet.' });
  return items;
}

export function overallState(items: HealthItem[]): HealthState {
  if (items.some((i) => i.state === 'error')) return 'error';
  if (items.some((i) => i.state === 'warning')) return 'warning';
  if (items.some((i) => i.state === 'healthy')) return 'healthy';
  return 'unknown';
}

// Which sidebar entries deserve a small attention dot — only when the data says there is something to look at.
export function pulseAttention(p: SystemPulse): Partial<Record<AdminPage, boolean>> {
  const items = deriveHealth(p);
  const overall = overallState(items);
  const sync = p.sync;
  const needsSync = !!sync && (sync.queue.dead > 0 || sync.alerts.length > 0);
  const errorCount = !sync ? 0 : sync.alerts.length + sync.queue.dead + (sync.reconciliation.lastError && !sync.reconciliation.lastError.resolved ? 1 : 0);
  return {
    'continuous-sync': needsSync,
    errors: errorCount > 0,
    'system-health': overall === 'warning' || overall === 'error',
  };
}
