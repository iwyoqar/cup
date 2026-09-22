import { apiRequest } from './api';
import { PosterImportSummary } from './types';

// Phase 11.2 / 19 — Poster POS import admin API. PREVIEW is read-only (the backend default). A real import is a SEPARATE call that must say so explicitly
// (dryRun:false + confirm:true), carry the operator's refund-policy acknowledgement and the importable count they reviewed, and it is only ever made from the
// confirmation dialog — never on load, on a filter change or on a refresh.
export interface ImportWindow {
  since: string;
  until: string;
  limit: number;
}

export function previewPosterImport(window: ImportWindow): Promise<PosterImportSummary> {
  return apiRequest<PosterImportSummary>('/admin/poster/import-transactions', { method: 'POST', body: { ...window, dryRun: true } });
}

export function runPosterImport(window: ImportWindow, expectedImportable: number): Promise<PosterImportSummary> {
  return apiRequest<PosterImportSummary>('/admin/poster/import-transactions', {
    method: 'POST',
    body: { ...window, dryRun: false, confirm: true, acknowledgeRefundPolicy: true, expectedImportable },
  });
}

// ---- spot mapping -------------------------------------------------------------------------------------------------

export type SpotMappingStatus = 'MAPPED' | 'UNMAPPED_POSTER_SPOT' | 'DUPLICATE_MAPPING';

export interface SpotMappingReport {
  checkedAt: string;
  spots: { posterSpotId: number; posterName: string | null; status: SpotMappingStatus; branch: { id: string; name: string; isActive: boolean } | null; nameDiffers: boolean; importedTransactions: number }[];
  unmappedBranches: { id: string; name: string; posterSpotId: number; isActive: boolean; orders: number; importedTransactions: number }[];
  counts: { posterSpots: number; mapped: number; unmappedPosterSpots: number; unmappedBranches: number; duplicateMappings: number; inactiveBranches: number; nameDifferences: number };
  importReady: boolean;
  rules: string[];
}

export function fetchSpotMapping(): Promise<SpotMappingReport> {
  return apiRequest<SpotMappingReport>('/admin/poster/spot-mapping');
}

// ---- data quality -------------------------------------------------------------------------------------------------

export interface DataQualityReport {
  generatedAt: string;
  branch: SpotMappingReport['counts'] & { importReady: boolean };
  customer: { customers: number; linkedToPoster: number; notLinked: number };
  product: { importedLinesMapped: number; importedLinesUnmapped: number; unresolvedReceipts: number; modifiersNote: string };
  stored: {
    byStatus: { status: string; count: number }[];
    unresolvedReasons: { reason: string; count: number }[];
    imported: { count: number; totalMinor: number; paidMinor: number };
    importedWithoutItems: number;
    span: { firstOccurredAt: string | null; lastOccurredAt: string | null; firstImportedAt: string | null; lastImportedAt: string | null };
    perBranch: { branch: string; count: number; totalMinor: number }[];
  };
  live:
    | { available: false; reason: string }
    | {
        available: true;
        window: { since: string; until: string };
        scanned: number;
        truncated: boolean;
        transactions: Record<string, number>;
        revenueMinor: Record<string, number>;
        attribution: { attributedTransactions: number; unattributedTransactions: number; attributedRevenueMinor: number; unattributedRevenueMinor: number; note: string };
        customers: { receiptsWithLinkedCustomer: number; receiptsWithoutPosterClient: number; receiptsWithUnlinkedPosterClient: number };
        products: { unresolvedReceipts: number; unsupportedLineReceipts: number };
        partiallyPaidReceipts: number;
        refund: PosterImportSummary['refundPolicy'];
      };
  unattributedEvents: {
    loyaltyLedgerWithoutOrder: { rows: number; points: number };
    rewardRedemptionsWithoutOrder: number;
    promotionRedemptionsWithoutOrder: number;
    referrals: { qualified: number; attributedToAPurchase: number; unattributed: number };
    note: string;
  };
  refund: { policy: string; excludedByShape: string; neverAutomatic: string };
}

export function fetchDataQuality(window: ImportWindow | null): Promise<DataQualityReport> {
  const params = new URLSearchParams();
  if (window) {
    params.set('since', window.since);
    params.set('until', window.until);
    params.set('limit', String(Math.min(window.limit, 1000)));
    params.set('live', 'true');
  } else {
    params.set('live', 'false');
  }
  return apiRequest<DataQualityReport>(`/admin/poster/import-data-quality?${params.toString()}`);
}

// ---- history ------------------------------------------------------------------------------------------------------

export interface ImportHistoryFilters {
  page: number;
  pageSize: number;
  since?: string;
  until?: string;
  branchId?: string;
  status?: 'IMPORTED' | 'UNRESOLVED' | '';
  customer?: string;
}

export interface ImportHistoryPage {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  items: {
    posterTransactionId: string;
    occurredAt: string;
    importedAt: string;
    branchName: string;
    posterSpotId: number;
    customerName: string | null;
    totalMinor: number;
    paidMinor: number;
    status: string;
    unresolvedReason: string | null;
    source: string;
    lines: number;
  }[];
}

export function fetchImportHistory(filters: ImportHistoryFilters): Promise<ImportHistoryPage> {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: String(filters.pageSize) });
  if (filters.since) params.set('since', filters.since);
  if (filters.until) params.set('until', filters.until);
  if (filters.branchId) params.set('branchId', filters.branchId);
  if (filters.status) params.set('status', filters.status);
  if (filters.customer?.trim()) params.set('customer', filters.customer.trim());
  return apiRequest<ImportHistoryPage>(`/admin/poster/import-history?${params.toString()}`);
}

// ---- Phase 20: continuous sync (Poster webhooks) ------------------------------------------------------------------

export interface SyncStatus {
  generatedAt: string;
  config: {
    syncEnabled: boolean;
    applicationSecretConfigured: boolean;
    accountPinned: boolean;
    webhookPath: string;
    tickSeconds: number;
    reconcileMinutes: number;
    reconcileLookbackDays: number;
    reconcileOverlapMinutes: number;
    maxAttempts: number;
    settleSeconds: number;
  };
  queue: { queued: number; processing: number; done: number; dead: number; oldestQueuedAgeSeconds: number | null };
  webhooks: { lastReceivedAt: string | null; received24h: number; duplicateDeliveries24h: number; ignoredOtherObjects: number; rejectedSinceStart: number };
  processing: { lastProcessedAt: string | null; outcomes24h: { outcome: string; count: number }[] };
  reconciliation: {
    checkpoint: string | null; // every closed receipt before this moment has been decided; the next pass resumes here (minus the overlap)
    lagSeconds: number | null;
    lastSuccessAt: string | null;
    lastError: { at: string; message: string; resolved: boolean } | null;
    last: {
      at: string;
      ok: boolean;
      checkpointBefore: string | null;
      checkpointAfter: string | null;
      initialized: boolean;
      caughtUp: boolean;
      blockedBy: string | null;
      chunks: number;
      pages: number;
      scanned: number;
      alreadyImported: number;
      candidates: number;
      imported: number;
      unresolved: number;
      failed: number;
      deferred: number;
      missedWebhooks: number;
      error?: string;
    } | null;
  };
  removedButImported: string[];
  alerts: string[];
}

export interface WebhookEventsPage {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  items: { id: string; object: string; transactionId: string; action: string; eventAt: string; status: 'QUEUED' | 'PROCESSING' | 'DONE' | 'DEAD'; deliveries: number; attempts: number; nextAttemptAt: string; outcome: string | null; lastError: string | null; receivedAt: string; processedAt: string | null }[];
}

export function fetchSyncStatus(): Promise<SyncStatus> {
  return apiRequest<SyncStatus>('/admin/poster/sync-status');
}

export function fetchWebhookEvents(page: number, status: string): Promise<WebhookEventsPage> {
  const params = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (status) params.set('status', status);
  return apiRequest<WebhookEventsPage>('/admin/poster/webhook-events?' + params.toString());
}

export function retryWebhookEvent(id: string): Promise<{ requeued: boolean }> {
  return apiRequest<{ requeued: boolean }>('/admin/poster/webhook-events/' + encodeURIComponent(id) + '/retry', { method: 'POST' });
}
