import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Modal, PageHeader } from '../ui';

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
    <div className="analytics growth pi">
      <PageHeader description={findNav('pos-import').item.description} eyebrow="Poster POS" title={findNav('pos-import').item.label} />
      <p className="analytics__note pi__lead">
        Reads closed Poster receipts (read-only) and records the ones that belong to a linked CUP customer as <strong>POS purchases</strong>. Nothing is written until the very last step, and
        nothing here changes Poster, CUP orders, points or existing rewards. Imported purchases DO count in analytics, branch intelligence, customer profiles and reward progress.
      </p>

      <ol className="pi__steps" aria-label="Workflow">
        {['Check the branch mapping', 'Run a preview', 'Review the counts', 'Review unresolved / unattributed receipts', 'Confirm the refund policy', 'Import (confirmation dialog)', 'See the result'].map((label, i) => (
          <li key={label}>
            <span className="pi__step-n">{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <div className="callout">
        <div className="row row--between">
          <span>
            <strong>Receipts also arrive automatically.</strong> Poster webhooks, the queue and the recovery check are monitored on their own page.
          </span>
          <button className="button-secondary button--sm" onClick={() => onNavigate('continuous-sync')} type="button">
            Open Continuous Sync
          </button>
        </div>
      </div>

      <SpotMappingCard description="Step 1 of the import: receipts are imported only from Poster spots that map to an active CUP branch." error={mappingError} loading={mappingLoading} mapping={mapping} onReload={loadMapping} title="1. Poster spot mapping" />

      <section className="analytics__panel" aria-label="Import preview">
        <h2 className="analytics__h2">2. Import preview</h2>
        <div className="analytics__custom pi__window">
          <label>
            From <input onChange={(e) => setSince(e.target.value)} type="date" value={since} />
          </label>
          <label>
            To <input onChange={(e) => setUntil(e.target.value)} type="date" value={until} />
          </label>
          <label>
            Limit{' '}
            <input className="pi__limit" max={MAX_IMPORT_LIMIT} min={1} onChange={(e) => setLimit(Number(e.target.value))} type="number" value={limit} />
          </label>
          <button className="button-primary" disabled={previewBusy || !windowValid} onClick={runPreview} type="button">
            {previewBusy ? 'Reading Poster…' : 'Run preview'}
          </button>
        </div>
        <p className="analytics__note">A preview only READS Poster and CUP. Windows are limited to 31 days and {MAX_IMPORT_LIMIT} receipts, oldest first. Changing these values locks the Import step again.</p>
        {!windowValid && <p className="pi__warn">Choose a start date that is not after the end date and a limit between 1 and {MAX_IMPORT_LIMIT}.</p>}
        {previewError && (
          <div className="analytics__error" role="alert">
            <span>{previewError}</span>
          </div>
        )}
        {preview && <PreviewResult stale={!previewCurrent} summary={preview} />}
      </section>

      <QualitySection
        busy={qualityBusy}
        canLive={windowValid}
        error={qualityError}
        onLive={() => loadQuality({ since, until, limit })}
        onStored={() => loadQuality(null)}
        quality={quality}
      />

      <HistorySection branches={mapping?.spots.filter((s) => s.branch).map((s) => ({ id: s.branch!.id, name: s.branch!.name })) ?? []} reloadKey={historyKey} />

      <section className="analytics__panel pi__action" aria-label="Import action">
        <h2 className="analytics__h2">3. Import</h2>
        {result && <ImportResult summary={result} />}
        <p className="analytics__note">
          Refund / return handling is <strong>unverified</strong>: Poster shows no trace of a refunded closed receipt in this account. Receipts with a negative amount or quantity are excluded, nothing is
          imported as a negative sale, and an imported receipt is never reversed automatically.
        </p>
        <label className="pi__check">
          <input checked={acknowledged} disabled={!previewCurrent} onChange={(e) => setAcknowledged(e.target.checked)} type="checkbox" />
          <span>I understand the refund policy above.</span>
        </label>
        {blockers.length > 0 && (
          <ul className="pi__blockers">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <button className="button-danger" disabled={blockers.length > 0 || importBusy} onClick={() => { setImportError(null); setDialogOpen(true); }} type="button">
          {preview && previewCurrent ? `Review and import ${number(preview.importable)} receipt${preview.importable === 1 ? '' : 's'}…` : 'Review and import…'}
        </button>
        <p className="analytics__note" style={{ marginBottom: 0 }}>
          The button only opens a confirmation dialog. Nothing is written until you confirm there.
        </p>
      </section>

      {dialogOpen && preview && (
        <ConfirmDialog busy={importBusy} error={importError} onCancel={() => setDialogOpen(false)} onConfirm={confirmImport} summary={preview} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- 1. mapping

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
    <div className={stale ? 'pi__stale' : undefined}>
      {stale && <p className="pi__warn">The dates or limit changed after this preview — it no longer matches. Run a new preview before importing.</p>}
      <p className="analytics__range" style={{ margin: '12px 0' }}>
        Preview (nothing written) · {summary.window.since === summary.window.until ? summary.window.since : `${summary.window.since} → ${summary.window.until}`} · {number(summary.scanned)} receipts scanned
        {summary.truncated ? ' — more receipts exist in this window than the limit; raise the limit or narrow the dates' : ''}
      </p>
      <div className="pi__counts">
        <div className="pi__count pi__count--strong">
          <div className="analytics__label">Importable</div>
          <div className="pi__count-n">{number(summary.importable)}</div>
        </div>
        {CATEGORY_ORDER.filter((c) => c !== 'IMPORTABLE').map((c) => (
          <div className="pi__count" key={c}>
            <div className="analytics__label">{CATEGORY_LABELS[c]}</div>
            <div className="pi__count-n">{number(summary.categories[c])}</div>
          </div>
        ))}
      </div>
      <p className="analytics__note">
        Totals: importable {formatSom(summary.revenueByCategoryMinor.IMPORTABLE)}
        {summary.partiallyPaid > 0 ? ` · ${summary.partiallyPaid} importable receipt${summary.partiallyPaid === 1 ? ' is' : 's are'} only partly paid (a free / discounted line)` : ''}. A receipt with no linked CUP customer is still
        imported (anonymously) as long as its branch and products are mapped. Poster reads: {summary.posterReads.transactions + summary.posterReads.deletedTransactions + summary.posterReads.incomingOrderLinks}.
      </p>
      <div className="pi__refund">
        <strong>Refund policy: {r.status.replace('_', ' ')}.</strong> {r.excludedReceipts} receipt{r.excludedReceipts === 1 ? '' : 's'} excluded for a negative amount / quantity.{' '}
        {r.deletedInPosterWindow === null ? 'Poster’s deleted-receipt list could not be read.' : `Poster lists ${r.deletedInPosterWindow} deleted receipt${r.deletedInPosterWindow === 1 ? '' : 's'} in this window.`}
        {r.importedButDeletedInPoster.length > 0 && <span className="pi__warn"> Already imported but now deleted in Poster: #{r.importedButDeletedInPoster.join(', #')} — review manually (never reversed automatically).</span>}
      </div>

      <div className="pi__row" style={{ marginTop: 16 }}>
        <h3 className="bi__h3" style={{ margin: 0 }}>
          Receipts
        </h3>
        <select
          aria-label="Filter receipts"
          className="analytics__select"
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
        </select>
      </div>
      {slice.length === 0 ? (
        <p className="analytics__empty">{summary.details.length === 0 ? 'No closed receipts in this window.' : 'No receipts match this filter.'}</p>
      ) : (
        <div className="c360__scroll">
          <table className="analytics__table pi__table pi__table--wide">
            <thead>
              <tr>
                <th>Poster #</th>
                <th>Closed</th>
                <th>Branch</th>
                <th>Customer</th>
                <th className="analytics__num">Total</th>
                <th className="analytics__num">Paid</th>
                <th>Decision</th>
                <th>Reason</th>
                <th>Products</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((d) => (
                <tr key={d.posterTransactionId}>
                  <td>#{d.posterTransactionId}</td>
                  <td>{d.occurredAt ? formatDateTime(d.occurredAt) : '—'}</td>
                  <td className="bi__name">{d.branchName ?? (d.posterSpotId ? `Spot #${d.posterSpotId} (no branch)` : '—')}</td>
                  <td className="bi__name">{d.customerName ?? (d.hasPosterClient ? 'Unlinked Poster customer' : 'No customer')}</td>
                  <td className="analytics__num">{d.totalMinor === undefined ? '—' : formatSom(d.totalMinor)}</td>
                  <td className="analytics__num">{d.paidMinor === undefined ? '—' : formatSom(d.paidMinor)}</td>
                  <td>
                    <span className={`pi__badge ${d.decision === 'IMPORT' ? 'pi__badge--ok' : d.decision === 'UNRESOLVED' ? 'pi__badge--warn' : ''}`}>{DECISION_LABEL[d.decision]}</span>
                  </td>
                  <td className="bi__name">{d.reason ? REASON_LABELS[d.reason] ?? d.reason : CATEGORY_LABELS[d.category]}</td>
                  <td className="bi__name">
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
    <section className="analytics__panel" aria-label="Data quality">
      <div className="pi__row">
        <h2 className="analytics__h2">Data quality</h2>
        <div className="pi__btns">
          <button className="bi__open" disabled={busy} onClick={onStored} type="button">
            {busy ? 'Loading…' : 'Refresh'}
          </button>
          <button className="bi__open" disabled={busy || !canLive} onClick={onLive} type="button" title="Reads Poster (read-only) for the dates above">
            Include live scan of the window
          </button>
        </div>
      </div>
      {error && (
        <div className="analytics__error" role="alert">
          <span>{error}</span>
          <button className="analytics__retry" onClick={onStored} type="button">
            Retry
          </button>
        </div>
      )}
      {!quality && !error && <p className="analytics__empty">Loading…</p>}
      {quality && (
        <div className="pi__grid">
          <div className="pi__card">
            <h3 className="bi__h3">Branch</h3>
            <dl className="bi__facts">
              <Fact label="Poster spots" value={number(quality.branch.posterSpots)} />
              <Fact label="Mapped" value={number(quality.branch.mapped)} />
              <Fact label="Unmapped Poster spots" value={number(quality.branch.unmappedPosterSpots)} />
              <Fact label="CUP branches without a spot" value={number(quality.branch.unmappedBranches)} />
              <Fact label="Duplicate mappings" value={number(quality.branch.duplicateMappings)} />
              <Fact label="Inactive branches" value={number(quality.branch.inactiveBranches)} />
            </dl>
          </div>
          <div className="pi__card">
            <h3 className="bi__h3">Customer</h3>
            <dl className="bi__facts">
              <Fact label="CUP customers" value={number(quality.customer.customers)} />
              <Fact label="Linked to a Poster client" value={number(quality.customer.linkedToPoster)} />
              <Fact label="Not linked" value={number(quality.customer.notLinked)} />
            </dl>
            <p className="analytics__note">A receipt is only imported for a customer linked to its Poster client. No customer is ever created automatically.</p>
          </div>
          <div className="pi__card">
            <h3 className="bi__h3">Product</h3>
            <dl className="bi__facts">
              <Fact label="Imported lines with a CUP product" value={number(quality.product.importedLinesMapped)} />
              <Fact label="Imported lines without one" value={number(quality.product.importedLinesUnmapped)} />
              <Fact label="Unresolved receipts (unmapped product)" value={number(quality.product.unresolvedReceipts)} />
            </dl>
            <p className="analytics__note">{quality.product.modifiersNote}</p>
          </div>
          <div className="pi__card">
            <h3 className="bi__h3">Stored in CUP</h3>
            <dl className="bi__facts">
              {quality.stored.byStatus.length === 0 ? <Fact label="Imported / unresolved receipts" value="0" /> : quality.stored.byStatus.map((s) => <Fact key={s.status} label={s.status === 'IMPORTED' ? 'Imported' : s.status === 'UNRESOLVED' ? 'Unresolved (audit only)' : s.status} value={number(s.count)} />)}
              <Fact label="Imported revenue" value={formatSom(quality.stored.imported.totalMinor)} />
              <Fact label="Imported paid amount" value={formatSom(quality.stored.imported.paidMinor)} />
              <Fact label="Imported receipts without lines" value={number(quality.stored.importedWithoutItems)} hint={quality.stored.importedWithoutItems === 0 ? 'OK' : 'needs review'} />
            </dl>
            {quality.stored.unresolvedReasons.length > 0 && (
              <ul className="bi__list">
                {quality.stored.unresolvedReasons.map((u) => (
                  <li key={u.reason}>
                    <span>{REASON_LABELS[u.reason] ?? u.reason}</span>
                    <strong>{number(u.count)}</strong>
                  </li>
                ))}
              </ul>
            )}
            {quality.stored.perBranch.length > 0 && (
              <ul className="bi__list">
                {quality.stored.perBranch.map((b) => (
                  <li key={b.branch}>
                    <span className="bi__name">{b.branch}</span>
                    <strong>
                      {number(b.count)} · {formatSom(b.totalMinor)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="pi__card pi__card--wide">
            <h3 className="bi__h3">Live scan (Poster window)</h3>
            {quality.live.available ? (
              <>
                <p className="analytics__note" style={{ marginTop: 0 }}>
                  {quality.live.window.since} → {quality.live.window.until} · {number(quality.live.scanned)} receipts{quality.live.truncated ? ' (truncated by the limit)' : ''}
                </p>
                <div className="analytics__two">
                  <dl className="bi__facts">
                    {CATEGORY_ORDER.map((c) => (
                      <Fact key={c} label={CATEGORY_LABELS[c]} value={number(quality.live.available ? quality.live.transactions[c] ?? 0 : 0)} hint={formatSom(quality.live.available ? quality.live.revenueMinor[c] ?? 0 : 0)} />
                    ))}
                  </dl>
                  <div>
                    <dl className="bi__facts">
                      <Fact label="Attributed receipts" value={number(quality.live.attribution.attributedTransactions)} hint={formatSom(quality.live.attribution.attributedRevenueMinor)} />
                      <Fact label="Unattributed receipts" value={number(quality.live.attribution.unattributedTransactions)} hint={formatSom(quality.live.attribution.unattributedRevenueMinor)} />
                      <Fact label="Scanned receipts with no Poster customer (any status)" value={number(quality.live.customers.receiptsWithoutPosterClient)} />
                      <Fact label="Scanned receipts whose Poster customer is not linked (any status)" value={number(quality.live.customers.receiptsWithUnlinkedPosterClient)} />
                      <Fact label="Partly paid receipts" value={number(quality.live.partiallyPaidReceipts)} />
                    </dl>
                    <p className="analytics__note">{quality.live.attribution.note}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="analytics__note" style={{ margin: 0 }}>
                Not loaded ({quality.live.reason}). Press “Include live scan of the window” to read Poster (read-only) for the dates above.
              </p>
            )}
          </div>
          <div className="pi__card pi__card--wide">
            <h3 className="bi__h3">Attribution gaps elsewhere (never assigned to a branch)</h3>
            <dl className="bi__facts">
              <Fact label="Loyalty ledger rows with no order" value={number(quality.unattributedEvents.loyaltyLedgerWithoutOrder.rows)} hint={`${number(quality.unattributedEvents.loyaltyLedgerWithoutOrder.points)} points`} />
              <Fact label="Reward redemptions with no order" value={number(quality.unattributedEvents.rewardRedemptionsWithoutOrder)} />
              <Fact label="Promotion redemptions with no order" value={number(quality.unattributedEvents.promotionRedemptionsWithoutOrder)} />
              <Fact label="Referrals qualified / not tied to a purchase" value={`${number(quality.unattributedEvents.referrals.qualified)} / ${number(quality.unattributedEvents.referrals.unattributed)}`} />
            </dl>
            <p className="analytics__note" style={{ marginBottom: 0 }}>{quality.unattributedEvents.note}</p>
          </div>
        </div>
      )}
    </section>
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
    <section className="analytics__panel" aria-label="Import history">
      <h2 className="analytics__h2">Import history</h2>
      <div className="analytics__custom pi__filters">
        <label>
          From <input onChange={(e) => { setSince(e.target.value); setPage(1); }} type="date" value={since} />
        </label>
        <label>
          To <input onChange={(e) => { setUntil(e.target.value); setPage(1); }} type="date" value={until} />
        </label>
        <select aria-label="Branch" className="analytics__select" onChange={(e) => { setBranchId(e.target.value); setPage(1); }} value={branchId}>
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select aria-label="Status" className="analytics__select" onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} value={status}>
          <option value="">All statuses</option>
          <option value="IMPORTED">Imported</option>
          <option value="UNRESOLVED">Unresolved (audit)</option>
        </select>
        <form
          className="pi__search"
          onSubmit={(e) => {
            e.preventDefault();
            changed(() => setCustomerApplied(customer))();
          }}
        >
          <input aria-label="Customer name" maxLength={60} onChange={(e) => setCustomer(e.target.value)} placeholder="Customer name" type="search" value={customer} />
          <button className="bi__open" type="submit">
            Search
          </button>
        </form>
        <span className="analytics__hint">Source: POS</span>
      </div>
      {!rangeValid && <p className="pi__warn">Choose a start date that is not after the end date.</p>}
      {error && (
        <div className="analytics__error" role="alert">
          <span>{error}</span>
          <button className="analytics__retry" onClick={() => setRetryKey((k) => k + 1)} type="button">
            Retry
          </button>
        </div>
      )}
      {loading && !data && <p className="analytics__empty">Loading…</p>}
      {data && (
        <div className={loading ? 'analytics__body--loading' : undefined}>
          {data.items.length === 0 ? (
            <p className="analytics__empty">{filtersActive ? 'No receipts match these filters.' : 'Nothing has been imported yet.'}</p>
          ) : (
            <div className="c360__scroll">
              <table className="analytics__table pi__table pi__table--wide">
                <thead>
                  <tr>
                    <th>Poster #</th>
                    <th>Closed</th>
                    <th>Branch</th>
                    <th>Customer</th>
                    <th className="analytics__num">Amount</th>
                    <th>Status</th>
                    <th>Imported at</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i) => (
                    <tr key={i.posterTransactionId}>
                      <td>#{i.posterTransactionId}</td>
                      <td>{formatDateTime(i.occurredAt)}</td>
                      <td className="bi__name">{i.branchName}</td>
                      <td className="bi__name">{i.customerName ?? '—'}</td>
                      <td className="analytics__num">{formatSom(i.totalMinor)}</td>
                      <td>
                        <span className={`pi__badge ${i.status === 'IMPORTED' ? 'pi__badge--ok' : 'pi__badge--warn'}`}>{i.status === 'IMPORTED' ? 'Imported' : 'Unresolved'}</span>
                        {i.unresolvedReason && <span className="analytics__hint pi__sub">{REASON_LABELS[i.unresolvedReason] ?? i.unresolvedReason}</span>}
                      </td>
                      <td>{formatDateTime(i.importedAt)}</td>
                      <td>{i.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="analytics__note" style={{ marginBottom: 0 }}>
            {number(data.total)} receipt{data.total === 1 ? '' : 's'} · page {data.page} of {data.pages}
          </p>
          {data.pages > 1 && <Pager page={data.page} pages={data.pages} onPage={setPage} />}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- import result / dialog

function ImportResult({ summary }: { summary: PosterImportSummary }) {
  return (
    <div className={summary.failed > 0 ? 'pi__result pi__result--warn' : 'pi__result'} role="status">
      <strong>{summary.failed > 0 ? 'Import finished with failures.' : 'Import finished.'}</strong>
      <div>
        Imported now: <strong>{number(summary.imported)}</strong>
        {summary.importedTransactionIds.length > 0 && <> (Poster #{summary.importedTransactionIds.join(', #')})</>} · already imported: {number(summary.alreadyImported)} · failed and rolled back: {number(summary.failed)} · unresolved kept for audit: {number(summary.unresolved)}
      </div>
      {summary.failed > 0 && <div>Run a new preview and import again — completed receipts are skipped and only the missing ones are written.</div>}
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
          <button className="button-secondary" disabled={busy} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="button-danger" disabled={!understood || busy} onClick={onConfirm} type="button">
            {busy ? 'Importing…' : `Import ${number(summary.importable)} receipt${summary.importable === 1 ? '' : 's'}`}
          </button>
        </>
      }
      onClose={onCancel}
      title={`Import ${number(summary.importable)} POS receipt${summary.importable === 1 ? '' : 's'}?`}
    >
      <div className="callout callout--err">
        <strong>This action writes POS transaction data into CUP.</strong>
      </div>
      <ul className="pi__dialog-list">
        <li>
          {number(importIds.length)} receipt{importIds.length === 1 ? '' : 's'}, {formatSom(total)} in total (Poster #{importIds.slice(0, 12).join(', #')}
          {importIds.length > 12 ? `, … +${importIds.length - 12}` : ''}).
        </li>
        {summary.unresolved > 0 && <li>{number(summary.unresolved)} unresolved receipt{summary.unresolved === 1 ? '' : 's'} will be kept for audit only (never counted).</li>}
        <li>Analytics, branch intelligence, customer profiles, growth and reward progress will start counting these purchases. Reward availability can rise.</li>
        <li>Nothing is changed in Poster, and no points, rewards, referrals or messages are created.</li>
        <li>Importing again is safe: receipts already imported are skipped.</li>
      </ul>
      <label className="pi__check">
        <input checked={understood} onChange={(e) => setUnderstood(e.target.checked)} type="checkbox" />
        <span>I reviewed these {number(summary.importable)} receipts and want to write them into CUP.</span>
      </label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------- small pieces

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bi__fact">
      <dt>{label}</dt>
      <dd>
        {value}
        {hint && <span className="analytics__hint"> · {hint}</span>}
      </dd>
    </div>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  return (
    <div className="pi__pager">
      <button className="bi__open" disabled={page <= 1} onClick={() => onPage(page - 1)} type="button">
        Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button className="bi__open" disabled={page >= pages} onClick={() => onPage(page + 1)} type="button">
        Next
      </button>
    </div>
  );
}
