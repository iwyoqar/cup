import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DataQualityReport,
  fetchDataQuality,
  fetchImportHistory,
  fetchSpotMapping,
  ImportHistoryPage,
  previewPosterImport,
  runPosterImport,
  SpotMappingReport,
} from '../lib/adminPosterImport';
import { ApiError } from '../lib/api';
import { formatDateTime, formatSom } from '../lib/format';
import { PosterImportCategory, PosterImportDetail, PosterImportSummary } from '../lib/types';
import { AdminPage, findNav } from '../lib/nav';
import { SpotMappingCard } from '../components/SpotMappingCard';
import { Button, cx, EmptyState, ErrorState, Input, Modal, PageHeader, SectionCard, Select, StatusBadge } from '../ui';

const number = (n: number) => n.toLocaleString('ru-RU');
const isoDate = (daysAgo: number) => new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString().slice(0, 10);
const message = (err: unknown, fallback: string) => (err instanceof ApiError && err.status !== 0 && err.backendMessage !== 'network_error' && typeof err.backendMessage === 'string' ? err.backendMessage : fallback);

const MAX_IMPORT_LIMIT = 100; // the backend refuses a real import above this

const CATEGORY_LABELS: Record<PosterImportCategory, string> = {
  IMPORTABLE: 'Importable',
  ALREADY_IMPORTED: 'Already imported',
  CUP_ORIGINATED: 'CUP-originated (skipped)',
  POSSIBLE_CUP_ORIGIN: 'Possible CUP origin (skipped)',
  UNRESOLVED: 'Unresolved product',
  UNSUPPORTED_LINE: 'Unsupported line',
  UNMAPPED_BRANCH: 'Unmapped branch',
  UNPAID: 'Unpaid',
  TOO_RECENT: 'Too recent',
  REFUND_UNVERIFIED: 'Refund-like (excluded)',
  OTHER: 'Other',
};
const CATEGORY_ORDER: PosterImportCategory[] = ['IMPORTABLE', 'ALREADY_IMPORTED', 'CUP_ORIGINATED', 'POSSIBLE_CUP_ORIGIN', 'UNRESOLVED', 'UNSUPPORTED_LINE', 'UNMAPPED_BRANCH', 'UNPAID', 'TOO_RECENT', 'REFUND_UNVERIFIED', 'OTHER'];

const REASON_LABELS: Record<string, string> = {
  BRANCH_NOT_MAPPED: 'Poster spot has no CUP branch',
  BRANCH_INACTIVE: 'CUP branch is inactive',
  NOT_A_PAID_SALE: 'Not a paid sale (unpaid / zero total)',
  NOT_CLOSED: 'Receipt is not closed',
  TOO_RECENT: 'Closed too recently (settling delay)',
  NO_LINES: 'Receipt has no product lines',
  INVALID_TRANSACTION: 'Receipt could not be read safely',
  UNMAPPED_PRODUCT: 'A product line has no CUP product',
  MODIFICATION_NOT_SUPPORTED: 'A line uses a Poster modifier',
  NON_INTEGER_QUANTITY: 'A line has a fractional quantity',
  INVALID_AMOUNT: 'A line has an invalid amount',
  REFUND_UNVERIFIED: 'Negative amount / quantity — refund semantics are unverified',
  APPLICATION_ID_UNLINKED: 'Carries an application id but no CUP link (possible CUP order)',
  WRITE_FAILED: 'Write failed and was rolled back — run the import again',
};

const DECISION_LABEL: Record<PosterImportDetail['decision'], string> = {
  IMPORT: 'Import',
  SKIP: 'Skip',
  ALREADY_IMPORTED: 'Already imported',
  CUP_ORIGINATED: 'CUP-originated',
  UNRESOLVED: 'Unresolved',
};

// Phase 19 — POS Import. A deliberate, staged workflow: check the mapping -> run a read-only preview -> review -> acknowledge the refund policy -> open the
// confirmation dialog -> confirm. NOTHING on this page writes to CUP except that final confirmation: loading, refreshing, changing a filter or the window,
// and navigating away only ever read.
export function PosterImportPage({ onNavigate }: { onNavigate: (page: AdminPage) => void }) {
  const [since, setSince] = useState(isoDate(7));
  const [until, setUntil] = useState(isoDate(0));
  const [limit, setLimit] = useState(50);

  const [mapping, setMapping] = useState<SpotMappingReport | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [mappingLoading, setMappingLoading] = useState(true);

  const [preview, setPreview] = useState<PosterImportSummary | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [quality, setQuality] = useState<DataQualityReport | null>(null);
  const [qualityError, setQualityError] = useState<string | null>(null);
  const [qualityBusy, setQualityBusy] = useState(false);

  const [acknowledged, setAcknowledged] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<PosterImportSummary | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const key = `${since}|${until}|${limit}`;
  const windowValid = since !== '' && until !== '' && since <= until && Number.isInteger(limit) && limit >= 1 && limit <= MAX_IMPORT_LIMIT;

  const loadMapping = useCallback(() => {
    setMappingLoading(true);
    setMappingError(null);
    fetchSpotMapping()
      .then(setMapping)
      .catch((err) => setMappingError(message(err, 'Could not read the Poster spots.')))
      .finally(() => setMappingLoading(false));
  }, []);

  const loadQuality = useCallback((live: { since: string; until: string; limit: number } | null) => {
    setQualityBusy(true);
    setQualityError(null);
    fetchDataQuality(live)
      .then(setQuality)
      .catch((err) => setQualityError(message(err, 'Could not load the data-quality report.')))
      .finally(() => setQualityBusy(false));
  }, []);

  // Read-only on load: the spot mapping and the STORED part of the data-quality report. No preview, no import.
  useEffect(() => {
    loadMapping();
    loadQuality(null);
  }, [loadMapping, loadQuality]);

  // Changing the window or the limit invalidates the reviewed preview: the Import step locks again until a new preview is run.
  const previewCurrent = preview !== null && previewKey === key;

  const runPreview = async () => {
    if (!windowValid) return;
    setPreviewBusy(true);
    setPreviewError(null);
    setResult(null);
    setAcknowledged(false);
    try {
      const summary = await previewPosterImport({ since, until, limit });
      setPreview(summary);
      setPreviewKey(key);
    } catch (err) {
      setPreview(null);
      setPreviewKey(null);
      setPreviewError(message(err, 'Preview failed.'));
    } finally {
      setPreviewBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!preview || !previewCurrent) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const summary = await runPosterImport({ since, until, limit }, preview.importable);
      setResult(summary);
      setDialogOpen(false);
      setPreview(null); // the reviewed preview is spent: a new import needs a new preview
      setPreviewKey(null);
      setAcknowledged(false);
      setHistoryKey((k) => k + 1);
      loadMapping();
      loadQuality(null);
    } catch (err) {
      setImportError(message(err, 'Import failed. Nothing was reported as imported — run a new preview.'));
    } finally {
      setImportBusy(false);
    }
  };

  const blockers = useMemo(() => {
    const list: string[] = [];
    if (!previewCurrent) list.push('Run a preview for the current dates and limit.');
    if (previewCurrent && preview && preview.importable === 0) list.push('The preview has nothing importable.');
    if (previewCurrent && preview && preview.categories.UNMAPPED_BRANCH > 0) list.push('Some receipts come from a Poster spot with no active CUP branch — fix the mapping first.');
    if (!acknowledged) list.push('Acknowledge the refund policy.');
    return list;
  }, [previewCurrent, preview, acknowledged]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader description={findNav('pos-import').item.description} eyebrow="Poster POS" title={findNav('pos-import').item.label} />
      <p className="-mt-2 max-w-3xl text-[13px] leading-relaxed text-muted">
        Reads closed Poster receipts (read-only) and records the ones that belong to a linked CUP customer as <strong>POS purchases</strong>. Nothing is written until the very last step, and
        nothing here changes Poster, CUP orders, points or existing rewards. Imported purchases DO count in analytics, branch intelligence, customer profiles and reward progress.
      </p>

      <ol aria-label="Workflow" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-[13px] text-muted">
        {['Check the branch mapping', 'Run a preview', 'Review the counts', 'Review unresolved / unattributed receipts', 'Confirm the refund policy', 'Import (confirmation dialog)', 'See the result'].map((label, i) => (
          <li className="flex items-center gap-2" key={label}>
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-black text-[11px] font-semibold text-cream">{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border-l-[3px] border-muted-cream bg-neutral-bg px-4 py-3 text-sm text-muted-cream">
        <span>
          <strong className="text-black">Receipts also arrive automatically.</strong> Poster webhooks, the queue and the recovery check are monitored on their own page.
        </span>
        <Button onClick={() => onNavigate('continuous-sync')} size="sm" variant="secondary">
          Open Continuous Sync
        </Button>
      </div>

      <SpotMappingCard description="Step 1 of the import: receipts are imported only from Poster spots that map to an active CUP branch." error={mappingError} loading={mappingLoading} mapping={mapping} onReload={loadMapping} title="1. Poster spot mapping" />

      <SectionCard title="2. Import preview">
        <div aria-label="Import preview" className="flex flex-wrap items-end gap-3" role="group">
          <LabeledField label="From">
            <Input onChange={(e) => setSince(e.target.value)} type="date" value={since} />
          </LabeledField>
          <LabeledField label="To">
            <Input onChange={(e) => setUntil(e.target.value)} type="date" value={until} />
          </LabeledField>
          <LabeledField label="Limit">
            <Input className="w-24" max={MAX_IMPORT_LIMIT} min={1} onChange={(e) => setLimit(Number(e.target.value))} type="number" value={limit} />
          </LabeledField>
          <Button disabled={!windowValid} loading={previewBusy} onClick={runPreview} variant="primary">
            {previewBusy ? 'Reading Poster…' : 'Run preview'}
          </Button>
        </div>
        <Note>A preview only READS Poster and CUP. Windows are limited to 31 days and {MAX_IMPORT_LIMIT} receipts, oldest first. Changing these values locks the Import step again.</Note>
        {!windowValid && <Warn>Choose a start date that is not after the end date and a limit between 1 and {MAX_IMPORT_LIMIT}.</Warn>}
        {previewError && (
          <div className="mt-3">
            <ErrorState message={previewError} title="Preview failed" />
          </div>
        )}
        {preview && <PreviewResult stale={!previewCurrent} summary={preview} />}
      </SectionCard>

      <QualitySection
        busy={qualityBusy}
        canLive={windowValid}
        error={qualityError}
        onLive={() => loadQuality({ since, until, limit })}
        onStored={() => loadQuality(null)}
        quality={quality}
      />

      <HistorySection branches={mapping?.spots.filter((s) => s.branch).map((s) => ({ id: s.branch!.id, name: s.branch!.name })) ?? []} reloadKey={historyKey} />

      <SectionCard title="3. Import">
        <div aria-label="Import action" className="flex flex-col items-start gap-3" role="group">
          {result && <ImportResult summary={result} />}
          <Note className="mt-0">
            Refund / return handling is <strong>unverified</strong>: Poster shows no trace of a refunded closed receipt in this account. Receipts with a negative amount or quantity are excluded, nothing is
            imported as a negative sale, and an imported receipt is never reversed automatically.
          </Note>
          <Check checked={acknowledged} disabled={!previewCurrent} onChange={setAcknowledged}>
            I understand the refund policy above.
          </Check>
          {blockers.length > 0 && (
            <ul className="m-0 list-disc space-y-0.5 pl-5 text-[13px] text-muted">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <Button disabled={blockers.length > 0 || importBusy} onClick={() => { setImportError(null); setDialogOpen(true); }} variant="danger">
            {preview && previewCurrent ? `Review and import ${number(preview.importable)} receipt${preview.importable === 1 ? '' : 's'}…` : 'Review and import…'}
          </Button>
          <Note className="mt-0">The button only opens a confirmation dialog. Nothing is written until you confirm there.</Note>
        </div>
      </SectionCard>

      {dialogOpen && preview && (
        <ConfirmDialog busy={importBusy} error={importError} onCancel={() => setDialogOpen(false)} onConfirm={confirmImport} summary={preview} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- 2. preview

function PreviewResult({ summary, stale }: { summary: PosterImportSummary; stale: boolean }) {
  const [filter, setFilter] = useState<'ALL' | 'IMPORT' | 'SKIPPED' | PosterImportCategory>('ALL');
  const [page, setPage] = useState(1);
  const shown = useMemo(() => {
    const rows = summary.details.filter((d) => (filter === 'ALL' ? true : filter === 'IMPORT' ? d.decision === 'IMPORT' : filter === 'SKIPPED' ? d.decision === 'SKIP' : d.category === filter));
    return [...rows].sort((a, b) => Number(a.posterTransactionId) - Number(b.posterTransactionId));
  }, [summary, filter]);
  const PAGE = 25;
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages);
  const slice = shown.slice((current - 1) * PAGE, current * PAGE);
  const r = summary.refundPolicy;

  return (
    <div className={cx('mt-4', stale && 'opacity-55')}>
      {stale && <Warn>The dates or limit changed after this preview — it no longer matches. Run a new preview before importing.</Warn>}
      <p className="my-3 text-[13px] font-semibold text-muted-cream">
        Preview (nothing written) · {summary.window.since === summary.window.until ? summary.window.since : `${summary.window.since} → ${summary.window.until}`} · {number(summary.scanned)} receipts scanned
        {summary.truncated ? ' — more receipts exist in this window than the limit; raise the limit or narrow the dates' : ''}
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
        <CountTile label="Importable" strong value={number(summary.importable)} />
        {CATEGORY_ORDER.filter((c) => c !== 'IMPORTABLE').map((c) => (
          <CountTile key={c} label={CATEGORY_LABELS[c]} value={number(summary.categories[c])} />
        ))}
      </div>
      <Note>
        Totals: importable {formatSom(summary.revenueByCategoryMinor.IMPORTABLE)}
        {summary.partiallyPaid > 0 ? ` · ${summary.partiallyPaid} importable receipt${summary.partiallyPaid === 1 ? ' is' : 's are'} only partly paid (a free / discounted line)` : ''}. A receipt with no linked CUP customer is still
        imported (anonymously) as long as its branch and products are mapped. Poster reads: {summary.posterReads.transactions + summary.posterReads.deletedTransactions + summary.posterReads.incomingOrderLinks}.
      </Note>
      <div className="mt-3 rounded-md border-l-[3px] border-terracotta bg-cream-soft px-4 py-3 text-[13px] leading-relaxed">
        <strong>Refund policy: {r.status.replace('_', ' ')}.</strong> {r.excludedReceipts} receipt{r.excludedReceipts === 1 ? '' : 's'} excluded for a negative amount / quantity.{' '}
        {r.deletedInPosterWindow === null ? 'Poster’s deleted-receipt list could not be read.' : `Poster lists ${r.deletedInPosterWindow} deleted receipt${r.deletedInPosterWindow === 1 ? '' : 's'} in this window.`}
        {r.importedButDeletedInPoster.length > 0 && <span className="font-semibold text-err"> Already imported but now deleted in Poster: #{r.importedButDeletedInPoster.join(', #')} — review manually (never reversed automatically).</span>}
      </div>

      <div className="mt-4 mb-2 flex flex-wrap items-center justify-between gap-3">
        <SubTitle>Receipts</SubTitle>
        <Select
          aria-label="Filter receipts"
          onChange={(e) => {
            setFilter(e.target.value as typeof filter);
            setPage(1);
          }}
          value={filter}
        >
          <option value="ALL">All ({summary.details.length})</option>
          <option value="IMPORT">To import ({summary.importable})</option>
          <option value="SKIPPED">Skipped</option>
          {CATEGORY_ORDER.filter((c) => summary.categories[c] > 0).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]} ({summary.categories[c]})
            </option>
          ))}
        </Select>
      </div>
      {slice.length === 0 ? (
        <EmptyState text={summary.details.length === 0 ? 'No closed receipts in this window.' : 'No receipts match this filter.'} title="No receipts" variant="inline" />
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Poster #</th>
                <th className={TH}>Closed</th>
                <th className={TH}>Branch</th>
                <th className={TH}>Customer</th>
                <th className={cx(TH, NUM)}>Total</th>
                <th className={cx(TH, NUM)}>Paid</th>
                <th className={TH}>Decision</th>
                <th className={TH}>Reason</th>
                <th className={TH}>Products</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((d) => (
                <tr className={TR} key={d.posterTransactionId}>
                  <td className={TD}>#{d.posterTransactionId}</td>
                  <td className={cx(TD, 'whitespace-nowrap')}>{d.occurredAt ? formatDateTime(d.occurredAt) : '—'}</td>
                  <td className={cx(TD, NAME)}>{d.branchName ?? (d.posterSpotId ? `Spot #${d.posterSpotId} (no branch)` : '—')}</td>
                  <td className={cx(TD, NAME)}>{d.customerName ?? (d.hasPosterClient ? 'Unlinked Poster customer' : 'No customer')}</td>
                  <td className={cx(TD, NUM)}>{d.totalMinor === undefined ? '—' : formatSom(d.totalMinor)}</td>
                  <td className={cx(TD, NUM)}>{d.paidMinor === undefined ? '—' : formatSom(d.paidMinor)}</td>
                  <td className={TD}>
                    <StatusBadge tone={d.decision === 'IMPORT' ? 'ok' : d.decision === 'UNRESOLVED' ? 'warn' : 'neutral'}>{DECISION_LABEL[d.decision]}</StatusBadge>
                  </td>
                  <td className={cx(TD, NAME)}>{d.reason ? REASON_LABELS[d.reason] ?? d.reason : CATEGORY_LABELS[d.category]}</td>
                  <td className={cx(TD, NAME)}>
                    {(d.lines ?? []).length === 0
                      ? '—'
                      : (d.lines ?? []).map((l) => `${l.productName ?? `Poster product #${l.posterProductId}`} ×${l.quantity}`).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && <Pager page={current} pages={pages} onPage={setPage} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- data quality

function QualitySection({ quality, error, busy, canLive, onLive, onStored }: { quality: DataQualityReport | null; error: string | null; busy: boolean; canLive: boolean; onLive: () => void; onStored: () => void }) {
  return (
    <SectionCard
      actions={
        <>
          <Button disabled={busy} onClick={onStored} size="sm" variant="secondary">
            {busy ? 'Loading…' : 'Refresh'}
          </Button>
          <Button disabled={busy || !canLive} onClick={onLive} size="sm" title="Reads Poster (read-only) for the dates above" variant="secondary">
            Include live scan of the window
          </Button>
        </>
      }
      title="Data quality"
    >
      {error && <ErrorState message={error} onRetry={onStored} title="Data quality could not be loaded" />}
      {!quality && !error && <EmptyState title="Loading…" variant="inline" />}
      {quality && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <QualityCard title="Branch">
            <Facts>
              <Fact label="Poster spots" value={number(quality.branch.posterSpots)} />
              <Fact label="Mapped" value={number(quality.branch.mapped)} />
              <Fact label="Unmapped Poster spots" value={number(quality.branch.unmappedPosterSpots)} />
              <Fact label="CUP branches without a spot" value={number(quality.branch.unmappedBranches)} />
              <Fact label="Duplicate mappings" value={number(quality.branch.duplicateMappings)} />
              <Fact label="Inactive branches" value={number(quality.branch.inactiveBranches)} />
            </Facts>
          </QualityCard>
          <QualityCard title="Customer">
            <Facts>
              <Fact label="CUP customers" value={number(quality.customer.customers)} />
              <Fact label="Linked to a Poster client" value={number(quality.customer.linkedToPoster)} />
              <Fact label="Not linked" value={number(quality.customer.notLinked)} />
            </Facts>
            <Note>A receipt is only imported for a customer linked to its Poster client. No customer is ever created automatically.</Note>
          </QualityCard>
          <QualityCard title="Product">
            <Facts>
              <Fact label="Imported lines with a CUP product" value={number(quality.product.importedLinesMapped)} />
              <Fact label="Imported lines without one" value={number(quality.product.importedLinesUnmapped)} />
              <Fact label="Unresolved receipts (unmapped product)" value={number(quality.product.unresolvedReceipts)} />
            </Facts>
            <Note>{quality.product.modifiersNote}</Note>
          </QualityCard>
          <QualityCard title="Stored in CUP">
            <Facts>
              {quality.stored.byStatus.length === 0 ? <Fact label="Imported / unresolved receipts" value="0" /> : quality.stored.byStatus.map((s) => <Fact key={s.status} label={s.status === 'IMPORTED' ? 'Imported' : s.status === 'UNRESOLVED' ? 'Unresolved (audit only)' : s.status} value={number(s.count)} />)}
              <Fact label="Imported revenue" value={formatSom(quality.stored.imported.totalMinor)} />
              <Fact label="Imported paid amount" value={formatSom(quality.stored.imported.paidMinor)} />
              <Fact label="Imported receipts without lines" value={number(quality.stored.importedWithoutItems)} hint={quality.stored.importedWithoutItems === 0 ? 'OK' : 'needs review'} />
            </Facts>
            {quality.stored.unresolvedReasons.length > 0 && (
              <MiniList>
                {quality.stored.unresolvedReasons.map((u) => (
                  <li className={MINI_ROW} key={u.reason}>
                    <span>{REASON_LABELS[u.reason] ?? u.reason}</span>
                    <strong>{number(u.count)}</strong>
                  </li>
                ))}
              </MiniList>
            )}
            {quality.stored.perBranch.length > 0 && (
              <MiniList>
                {quality.stored.perBranch.map((b) => (
                  <li className={MINI_ROW} key={b.branch}>
                    <span className={NAME}>{b.branch}</span>
                    <strong className="whitespace-nowrap">
                      {number(b.count)} · {formatSom(b.totalMinor)}
                    </strong>
                  </li>
                ))}
              </MiniList>
            )}
          </QualityCard>
          <QualityCard title="Live scan (Poster window)" wide>
            {quality.live.available ? (
              <>
                <Note className="mt-0">
                  {quality.live.window.since} → {quality.live.window.until} · {number(quality.live.scanned)} receipts{quality.live.truncated ? ' (truncated by the limit)' : ''}
                </Note>
                <div className="mt-2 grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
                  <Facts>
                    {CATEGORY_ORDER.map((c) => (
                      <Fact key={c} label={CATEGORY_LABELS[c]} value={number(quality.live.available ? quality.live.transactions[c] ?? 0 : 0)} hint={formatSom(quality.live.available ? quality.live.revenueMinor[c] ?? 0 : 0)} />
                    ))}
                  </Facts>
                  <div>
                    <Facts>
                      <Fact label="Attributed receipts" value={number(quality.live.attribution.attributedTransactions)} hint={formatSom(quality.live.attribution.attributedRevenueMinor)} />
                      <Fact label="Unattributed receipts" value={number(quality.live.attribution.unattributedTransactions)} hint={formatSom(quality.live.attribution.unattributedRevenueMinor)} />
                      <Fact label="Scanned receipts with no Poster customer (any status)" value={number(quality.live.customers.receiptsWithoutPosterClient)} />
                      <Fact label="Scanned receipts whose Poster customer is not linked (any status)" value={number(quality.live.customers.receiptsWithUnlinkedPosterClient)} />
                      <Fact label="Partly paid receipts" value={number(quality.live.partiallyPaidReceipts)} />
                    </Facts>
                    <Note>{quality.live.attribution.note}</Note>
                  </div>
                </div>
              </>
            ) : (
              <Note className="m-0">Not loaded ({quality.live.reason}). Press “Include live scan of the window” to read Poster (read-only) for the dates above.</Note>
            )}
          </QualityCard>
          <QualityCard title="Attribution gaps elsewhere (never assigned to a branch)" wide>
            <Facts>
              <Fact label="Loyalty ledger rows with no order" value={number(quality.unattributedEvents.loyaltyLedgerWithoutOrder.rows)} hint={`${number(quality.unattributedEvents.loyaltyLedgerWithoutOrder.points)} points`} />
              <Fact label="Reward redemptions with no order" value={number(quality.unattributedEvents.rewardRedemptionsWithoutOrder)} />
              <Fact label="Promotion redemptions with no order" value={number(quality.unattributedEvents.promotionRedemptionsWithoutOrder)} />
              <Fact label="Referrals qualified / not tied to a purchase" value={`${number(quality.unattributedEvents.referrals.qualified)} / ${number(quality.unattributedEvents.referrals.unattributed)}`} />
            </Facts>
            <Note className="mb-0">{quality.unattributedEvents.note}</Note>
          </QualityCard>
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------------------------- history

function HistorySection({ branches, reloadKey }: { branches: { id: string; name: string }[]; reloadKey: number }) {
  const [page, setPage] = useState(1);
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState<'' | 'IMPORTED' | 'UNRESOLVED'>('');
  const [customer, setCustomer] = useState('');
  const [customerApplied, setCustomerApplied] = useState('');
  const [data, setData] = useState<ImportHistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const rangeValid = since === '' || until === '' || since <= until;
  const filtersActive = since !== '' || until !== '' || branchId !== '' || status !== '' || customerApplied.trim() !== '';

  useEffect(() => {
    if (!rangeValid) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchImportHistory({ page, pageSize: 20, since: since || undefined, until: until || undefined, branchId: branchId || undefined, status, customer: customerApplied })
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(message(err, 'Could not load the import history.')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page, since, until, branchId, status, customerApplied, rangeValid, reloadKey, retryKey]);

  const changed = (fn: () => void) => () => {
    fn();
    setPage(1);
  };

  return (
    <SectionCard title="Import history">
      <div aria-label="Import history filters" className="flex flex-wrap items-end gap-3" role="group">
        <LabeledField label="From">
          <Input onChange={(e) => { setSince(e.target.value); setPage(1); }} type="date" value={since} />
        </LabeledField>
        <LabeledField label="To">
          <Input onChange={(e) => { setUntil(e.target.value); setPage(1); }} type="date" value={until} />
        </LabeledField>
        <Select aria-label="Branch" onChange={(e) => { setBranchId(e.target.value); setPage(1); }} value={branchId}>
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} value={status}>
          <option value="">All statuses</option>
          <option value="IMPORTED">Imported</option>
          <option value="UNRESOLVED">Unresolved (audit)</option>
        </Select>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            changed(() => setCustomerApplied(customer))();
          }}
        >
          <Input aria-label="Customer name" maxLength={60} onChange={(e) => setCustomer(e.target.value)} placeholder="Customer name" type="search" value={customer} />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <span className="self-center text-xs text-muted">Source: POS</span>
      </div>
      {!rangeValid && <Warn>Choose a start date that is not after the end date.</Warn>}
      {error && (
        <div className="mt-3">
          <ErrorState message={error} onRetry={() => setRetryKey((k) => k + 1)} title="Import history could not be loaded" />
        </div>
      )}
      {loading && !data && <EmptyState title="Loading…" variant="inline" />}
      {data && (
        <div className={cx('mt-3 transition-opacity duration-200', loading && 'opacity-55')}>
          {data.items.length === 0 ? (
            <EmptyState text={filtersActive ? 'No receipts match these filters.' : 'Nothing has been imported yet.'} title="No receipts" variant="inline" />
          ) : (
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Poster #</th>
                    <th className={TH}>Closed</th>
                    <th className={TH}>Branch</th>
                    <th className={TH}>Customer</th>
                    <th className={cx(TH, NUM)}>Amount</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Imported at</th>
                    <th className={TH}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i) => (
                    <tr className={TR} key={i.posterTransactionId}>
                      <td className={TD}>#{i.posterTransactionId}</td>
                      <td className={cx(TD, 'whitespace-nowrap')}>{formatDateTime(i.occurredAt)}</td>
                      <td className={cx(TD, NAME)}>{i.branchName}</td>
                      <td className={cx(TD, NAME)}>{i.customerName ?? '—'}</td>
                      <td className={cx(TD, NUM)}>{formatSom(i.totalMinor)}</td>
                      <td className={TD}>
                        <StatusBadge tone={i.status === 'IMPORTED' ? 'ok' : 'warn'}>{i.status === 'IMPORTED' ? 'Imported' : 'Unresolved'}</StatusBadge>
                        {i.unresolvedReason && <span className="mt-0.5 block text-xs text-muted">{REASON_LABELS[i.unresolvedReason] ?? i.unresolvedReason}</span>}
                      </td>
                      <td className={cx(TD, 'whitespace-nowrap')}>{formatDateTime(i.importedAt)}</td>
                      <td className={TD}>{i.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Note className="mb-0">
            {number(data.total)} receipt{data.total === 1 ? '' : 's'} · page {data.page} of {data.pages}
          </Note>
          {data.pages > 1 && <Pager page={data.page} pages={data.pages} onPage={setPage} />}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------------------------- import result / dialog

function ImportResult({ summary }: { summary: PosterImportSummary }) {
  const failed = summary.failed > 0;
  return (
    <div className={cx('w-full space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm', failed ? 'border-err bg-err-bg' : 'border-ok bg-ok-bg')} role="status">
      <strong className={failed ? 'text-err' : 'text-ok'}>{failed ? 'Import finished with failures.' : 'Import finished.'}</strong>
      <div>
        Imported now: <strong>{number(summary.imported)}</strong>
        {summary.importedTransactionIds.length > 0 && <> (Poster #{summary.importedTransactionIds.join(', #')})</>} · already imported: {number(summary.alreadyImported)} · failed and rolled back: {number(summary.failed)} · unresolved kept for audit: {number(summary.unresolved)}
      </div>
      {failed && <div>Run a new preview and import again — completed receipts are skipped and only the missing ones are written.</div>}
    </div>
  );
}

function ConfirmDialog({ summary, busy, error, onCancel, onConfirm }: { summary: PosterImportSummary; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  const [understood, setUnderstood] = useState(false);
  const importIds = summary.details.filter((d) => d.decision === 'IMPORT').map((d) => d.posterTransactionId);
  const total = summary.details.filter((d) => d.decision === 'IMPORT').reduce((n, d) => n + (d.totalMinor ?? 0), 0);

  return (
    <Modal
      dismissible={!busy}
      footer={
        <>
          <Button disabled={busy} onClick={onCancel} variant="secondary">
            Cancel
          </Button>
          <Button disabled={!understood} loading={busy} onClick={onConfirm} variant="danger">
            {busy ? 'Importing…' : `Import ${number(summary.importable)} receipt${summary.importable === 1 ? '' : 's'}`}
          </Button>
        </>
      }
      onClose={onCancel}
      title={`Import ${number(summary.importable)} POS receipt${summary.importable === 1 ? '' : 's'}?`}
    >
      <div className="rounded-md border-l-[3px] border-err bg-err-bg px-4 py-3 text-sm text-err">
        <strong>This action writes POS transaction data into CUP.</strong>
      </div>
      <ul className="my-4 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
        <li>
          {number(importIds.length)} receipt{importIds.length === 1 ? '' : 's'}, {formatSom(total)} in total (Poster #{importIds.slice(0, 12).join(', #')}
          {importIds.length > 12 ? `, … +${importIds.length - 12}` : ''}).
        </li>
        {summary.unresolved > 0 && <li>{number(summary.unresolved)} unresolved receipt{summary.unresolved === 1 ? '' : 's'} will be kept for audit only (never counted).</li>}
        <li>Analytics, branch intelligence, customer profiles, growth and reward progress will start counting these purchases. Reward availability can rise.</li>
        <li>Nothing is changed in Poster, and no points, rewards, referrals or messages are created.</li>
        <li>Importing again is safe: receipts already imported are skipped.</li>
      </ul>
      <Check checked={understood} onChange={setUnderstood}>
        I reviewed these {number(summary.importable)} receipts and want to write them into CUP.
      </Check>
      {error && (
        <p className="mt-3 text-[13px] font-semibold text-err" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------- small pieces

const TABLE = 'w-full min-w-[900px] border-separate border-spacing-0 text-sm';
const TH = 'border-b border-line bg-white px-3 py-2.5 text-left text-[11px] font-semibold tracking-[0.08em] whitespace-nowrap text-muted uppercase';
const TD = 'border-b border-line px-3 py-2.5 align-top';
const TR = 'transition-colors duration-150 hover:bg-hover [&:last-child>td]:border-b-0';
const NUM = 'text-right tabular-nums whitespace-nowrap';
const NAME = 'max-w-[280px] [overflow-wrap:anywhere]';
const MINI_ROW = 'flex items-baseline justify-between gap-3 py-1.5 text-[13px]';

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}

function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('mt-2 text-[13px] leading-relaxed text-muted', className)}>{children}</p>;
}

function Warn({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[13px] font-semibold text-err">{children}</p>;
}

function SubTitle({ children }: { children: ReactNode }) {
  return <h3 className="m-0 text-[11px] font-semibold tracking-[0.1em] text-muted uppercase">{children}</h3>;
}

function Check({ checked, disabled, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className={cx('flex items-start gap-2.5 text-sm', disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer')}>
      <input checked={checked} className="mt-0.5 size-4 shrink-0 accent-terracotta" disabled={disabled} onChange={(e) => onChange(e.target.checked)} type="checkbox" />
      <span>{children}</span>
    </label>
  );
}

function CountTile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx('rounded-md border px-3.5 py-3', strong ? 'border-black bg-black text-white' : 'border-line bg-white')}>
      <div className={cx('text-[11px] font-semibold tracking-[0.06em] uppercase', strong ? 'text-cream' : 'text-muted')}>{label}</div>
      <div className="mt-1 font-display text-2xl tabular-nums">{value}</div>
    </div>
  );
}

function QualityCard({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cx('rounded-md border border-line p-4', wide && 'lg:col-span-2')}>
      <SubTitle>{title}</SubTitle>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="m-0 divide-y divide-line">{children}</dl>;
}

function MiniList({ children }: { children: ReactNode }) {
  return <ul className="m-0 mt-3 list-none divide-y divide-line border-t border-line p-0">{children}</ul>;
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-[13px]">
      <dt className="text-muted-cream">{label}</dt>
      <dd className="m-0 text-right font-semibold whitespace-nowrap tabular-nums">
        {value}
        {hint && <span className="font-normal text-muted"> · {hint}</span>}
      </dd>
    </div>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-[13px] text-muted">
      <Button disabled={page <= 1} onClick={() => onPage(page - 1)} size="sm" variant="secondary">
        Previous
      </Button>
      <span>
        Page {page} of {pages}
      </span>
      <Button disabled={page >= pages} onClick={() => onPage(page + 1)} size="sm" variant="secondary">
        Next
      </Button>
    </div>
  );
}
