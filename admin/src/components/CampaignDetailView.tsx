import { useEffect, useState } from 'react';
import {
  deleteCampaign,
  fetchCampaign,
  fetchCampaignAudience,
  fetchCampaignRecipients,
  sendCampaign,
} from '../lib/adminCampaigns';
import { ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { AudiencePreviewPage, Campaign, CampaignRecipientItem } from '../lib/types';
import { Button, tableClass } from '../ui';

interface CampaignDetailViewProps {
  campaignId: string;
  onBack: () => void;
  onEdit: (campaign: Campaign) => void;
  onDeleted: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sending: 'Sending…',
  completed: 'Completed',
  failed: 'Failed',
};

const RECIPIENT_STATUS_LABELS: Record<string, string> = {
  // 'pending' covers both "not yet attempted" and "attempted, outcome uncertain" — this project
  // never auto-retries an uncertain Telegram send (see campaign-messaging.service.ts), so the
  // two cases aren't distinguished in stored data either. Labeled plainly rather than implying
  // a certainty the data doesn't have.
  pending: 'Pending',
  sent: 'Sent',
  failed: 'Failed',
  skipped: 'Skipped',
};

export function CampaignDetailView({ campaignId, onBack, onEdit, onDeleted }: CampaignDetailViewProps) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [showAudience, setShowAudience] = useState(false);
  const [audience, setAudience] = useState<AudiencePreviewPage | null>(null);

  const [confirmingSend, setConfirmingSend] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [recipients, setRecipients] = useState<CampaignRecipientItem[] | null>(null);
  const [recipientsCursor, setRecipientsCursor] = useState<string | null>(null);
  const [isLoadingMoreRecipients, setIsLoadingMoreRecipients] = useState(false);

  const loadCampaign = () => {
    setCampaign(null);
    setError(null);
    fetchCampaign(campaignId)
      .then(setCampaign)
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load campaign.'));
  };

  useEffect(() => {
    loadCampaign();
    setShowAudience(false);
    setAudience(null);
    setConfirmingSend(false);
    setRecipients(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // Recipient results are only meaningful once a send has actually started — fetched
  // automatically for sending/completed/failed, never for draft (there are none yet).
  useEffect(() => {
    if (!campaign || campaign.status === 'draft') {
      return;
    }
    fetchCampaignRecipients(campaignId)
      .then((page) => {
        setRecipients(page.items);
        setRecipientsCursor(page.nextCursor);
      })
      .catch(() => undefined);
  }, [campaign, campaignId]);

  const handleLoadAudience = () => {
    setShowAudience(true);
    setAudience(null);
    fetchCampaignAudience(campaignId)
      .then(setAudience)
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load audience preview.'));
  };

  const handleOpenSendConfirmation = () => {
    setConfirmingSend(true);
    setSendError(null);
    if (!audience) {
      handleLoadAudience();
    }
  };

  const handleConfirmSend = async () => {
    setIsSending(true);
    setSendError(null);
    try {
      const updated = await sendCampaign(campaignId);
      setCampaign(updated);
      setConfirmingSend(false);
    } catch (err) {
      setSendError(err instanceof ApiError ? err.backendMessage : 'Failed to send campaign.');
    } finally {
      setIsSending(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteCampaign(campaignId);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to delete campaign.');
      setIsDeleting(false);
    }
  };

  const handleLoadMoreRecipients = async () => {
    if (!recipientsCursor) return;
    setIsLoadingMoreRecipients(true);
    try {
      const page = await fetchCampaignRecipients(campaignId, recipientsCursor);
      setRecipients((current) => [...(current ?? []), ...page.items]);
      setRecipientsCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to load more recipients.');
    } finally {
      setIsLoadingMoreRecipients(false);
    }
  };

  return (
    <div>
      <Button onClick={onBack} className="mb-4" variant="secondary">
        ← Back to campaigns
      </Button>

      {error && <p className="text-[13px] font-semibold text-err">{error}</p>}
      {!campaign && !error && <p className="text-[13px] leading-snug text-muted">Loading...</p>}

      {campaign && (
        <>
          <h1>{campaign.name}</h1>
          {campaign.description && <p className="text-[13px] leading-snug text-muted">{campaign.description}</p>}

          <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Status</span>
              <span>{STATUS_LABELS[campaign.status] ?? campaign.status}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Segment</span>
              <span>{campaign.segment.name}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Channel</span>
              <span>Telegram</span>
            </div>
            <hr className="m-0 h-px border-0 bg-line" />
            <div>
              <span className="text-sm font-semibold">Message</span>
              <p className="whitespace-pre-wrap mt-2">{campaign.messageText}</p>
            </div>
          </div>

          {campaign.status !== 'draft' && (
            <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
              <h3 className="m-0">Delivery results</h3>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                <span className="text-sm font-semibold">Sent</span>
                <span>{campaign.stats.sent}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                <span className="text-sm font-semibold">Failed</span>
                <span>{campaign.stats.failed}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                <span className="text-sm font-semibold">Skipped (no Telegram account)</span>
                <span>{campaign.stats.skipped}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                <span className="text-sm font-semibold">Pending / uncertain</span>
                <span>{campaign.stats.pending}</span>
              </div>
            </div>
          )}

          {campaign.status === 'draft' && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button onClick={() => onEdit(campaign)} variant="secondary">
                Edit
              </Button>
              <Button onClick={handleLoadAudience} variant="secondary">
                Preview audience
              </Button>
              <Button onClick={handleOpenSendConfirmation} variant="primary">
                Send
              </Button>
              <Button disabled={isDeleting} onClick={handleDelete} variant="secondary">
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          )}

          {showAudience && campaign.status === 'draft' && !confirmingSend && (
            <AudiencePreviewCard audience={audience} />
          )}

          {confirmingSend && (
            <div className="mt-4 flex flex-col gap-4 rounded-lg border border-err bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
              <h3 className="m-0">Confirm sending this campaign</h3>
              <p className="text-[13px] leading-snug text-muted">
                This will send a real Telegram message to every eligible recipient below. This cannot be undone, and this campaign
                cannot be sent again afterward.
              </p>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                <span className="text-sm font-semibold">Campaign</span>
                <span>{campaign.name}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                <span className="text-sm font-semibold">Segment</span>
                <span>{campaign.segment.name}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                <span className="text-sm font-semibold">Current eligible recipients</span>
                <span>{audience ? audience.telegramEligibleCount : 'Loading...'}</span>
              </div>
              {audience && audience.skippedCount > 0 && (
                <p className="text-[13px] leading-snug text-muted">{audience.skippedCount} matching customer(s) will be skipped (no Telegram account).</p>
              )}
              <p className="text-[13px] leading-snug text-muted">Message preview:</p>
              <p className="whitespace-pre-wrap">{campaign.messageText}</p>
              {sendError && <p className="text-[13px] font-semibold text-err">{sendError}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button disabled={isSending || !audience} onClick={handleConfirmSend} variant="primary">
                  {isSending ? 'Sending...' : `Yes, send to ${audience?.telegramEligibleCount ?? 0} recipient(s)`}
                </Button>
                <Button disabled={isSending} onClick={() => setConfirmingSend(false)} variant="secondary">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {campaign.status !== 'draft' && (
            <>
              <h3>Recipients</h3>
              {recipients === null ? (
                <p className="text-[13px] leading-snug text-muted">Loading...</p>
              ) : recipients.length === 0 ? (
                <p className="text-[13px] leading-snug text-muted">No recipients.</p>
              ) : (
                <>
                  <table className={tableClass.table}>
                    <thead>
                      <tr>
                        <th className={tableClass.th}>Name</th>
                        <th className={tableClass.th}>Phone</th>
                        <th className={tableClass.th}>Status</th>
                        <th className={tableClass.th}>Sent</th>
                        <th className={tableClass.th}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipients.map((recipient) => (
                        <tr className={tableClass.tr} key={recipient.customerId}>
                          <td className={tableClass.td}>{recipient.displayName ?? '—'}</td>
                          <td className={tableClass.td}>{recipient.phone ?? '—'}</td>
                          <td className={tableClass.td}>{RECIPIENT_STATUS_LABELS[recipient.status] ?? recipient.status}</td>
                          <td className={tableClass.td}>{recipient.sentAt ? formatDateTime(recipient.sentAt) : '—'}</td>
                          <td className={tableClass.td}>{recipient.errorCode ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {recipientsCursor && (
                    <Button disabled={isLoadingMoreRecipients} onClick={handleLoadMoreRecipients} className="mt-3" variant="secondary">
                      {isLoadingMoreRecipients ? 'Loading...' : 'Load more'}
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function AudiencePreviewCard({ audience }: { audience: AudiencePreviewPage | null }) {
  if (!audience) {
    return (
      <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
        <p className="text-[13px] leading-snug text-muted">Loading audience...</p>
      </div>
    );
  }
  return (
    <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
      <h3 className="m-0">Current audience</h3>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
        <span className="text-sm font-semibold">Segment matches</span>
        <span>{audience.segmentMatchCount}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
        <span className="text-sm font-semibold">Telegram-eligible</span>
        <span>{audience.telegramEligibleCount}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
        <span className="text-sm font-semibold">Skipped (no Telegram account)</span>
        <span>{audience.skippedCount}</span>
      </div>
      {audience.items.length > 0 && (
        <table className={tableClass.table}>
          <thead>
            <tr>
              <th className={tableClass.th}>Name</th>
              <th className={tableClass.th}>Phone</th>
              <th className={tableClass.th}>Eligibility</th>
            </tr>
          </thead>
          <tbody>
            {audience.items.map((candidate) => (
              <tr className={tableClass.tr} key={candidate.customerId}>
                <td className={tableClass.td}>{candidate.displayName ?? '—'}</td>
                <td className={tableClass.td}>{candidate.phone ?? '—'}</td>
                <td className={tableClass.td}>{candidate.eligible ? 'Eligible' : 'Skipped — no Telegram account'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
