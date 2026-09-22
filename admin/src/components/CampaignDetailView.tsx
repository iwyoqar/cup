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
      <button className="button-secondary" onClick={onBack} style={{ marginBottom: 16 }} type="button">
        ← Back to campaigns
      </button>

      {error && <p className="error-text">{error}</p>}
      {!campaign && !error && <p className="hint-text">Loading...</p>}

      {campaign && (
        <>
          <h1>{campaign.name}</h1>
          {campaign.description && <p className="hint-text">{campaign.description}</p>}

          <div className="settings-card">
            <div className="settings-row">
              <span className="settings-row__label">Status</span>
              <span>{STATUS_LABELS[campaign.status] ?? campaign.status}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Segment</span>
              <span>{campaign.segment.name}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Channel</span>
              <span>Telegram</span>
            </div>
            <hr className="settings-divider" />
            <div>
              <span className="settings-row__label">Message</span>
              <p style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{campaign.messageText}</p>
            </div>
          </div>

          {campaign.status !== 'draft' && (
            <div className="settings-card">
              <h3 style={{ margin: 0 }}>Delivery results</h3>
              <div className="settings-row">
                <span className="settings-row__label">Sent</span>
                <span>{campaign.stats.sent}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row__label">Failed</span>
                <span>{campaign.stats.failed}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row__label">Skipped (no Telegram account)</span>
                <span>{campaign.stats.skipped}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row__label">Pending / uncertain</span>
                <span>{campaign.stats.pending}</span>
              </div>
            </div>
          )}

          {campaign.status === 'draft' && (
            <div className="settings-footer">
              <button className="button-secondary" onClick={() => onEdit(campaign)} type="button">
                Edit
              </button>
              <button className="button-secondary" onClick={handleLoadAudience} type="button">
                Preview audience
              </button>
              <button className="button-primary" onClick={handleOpenSendConfirmation} type="button">
                Send
              </button>
              <button className="button-secondary" disabled={isDeleting} onClick={handleDelete} type="button">
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          )}

          {showAudience && campaign.status === 'draft' && !confirmingSend && (
            <AudiencePreviewCard audience={audience} />
          )}

          {confirmingSend && (
            <div className="settings-card" style={{ borderColor: 'var(--cup-danger)' }}>
              <h3 style={{ margin: 0 }}>Confirm sending this campaign</h3>
              <p className="hint-text">
                This will send a real Telegram message to every eligible recipient below. This cannot be undone, and this campaign
                cannot be sent again afterward.
              </p>
              <div className="settings-row">
                <span className="settings-row__label">Campaign</span>
                <span>{campaign.name}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row__label">Segment</span>
                <span>{campaign.segment.name}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row__label">Current eligible recipients</span>
                <span>{audience ? audience.telegramEligibleCount : 'Loading...'}</span>
              </div>
              {audience && audience.skippedCount > 0 && (
                <p className="hint-text">{audience.skippedCount} matching customer(s) will be skipped (no Telegram account).</p>
              )}
              <p className="hint-text">Message preview:</p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{campaign.messageText}</p>
              {sendError && <p className="error-text">{sendError}</p>}
              <div className="settings-footer">
                <button className="button-primary" disabled={isSending || !audience} onClick={handleConfirmSend} type="button">
                  {isSending ? 'Sending...' : `Yes, send to ${audience?.telegramEligibleCount ?? 0} recipient(s)`}
                </button>
                <button className="button-secondary" disabled={isSending} onClick={() => setConfirmingSend(false)} type="button">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {campaign.status !== 'draft' && (
            <>
              <h3>Recipients</h3>
              {recipients === null ? (
                <p className="hint-text">Loading...</p>
              ) : recipients.length === 0 ? (
                <p className="hint-text">No recipients.</p>
              ) : (
                <>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Phone</th>
                        <th>Status</th>
                        <th>Sent</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipients.map((recipient) => (
                        <tr key={recipient.customerId}>
                          <td>{recipient.displayName ?? '—'}</td>
                          <td>{recipient.phone ?? '—'}</td>
                          <td>{RECIPIENT_STATUS_LABELS[recipient.status] ?? recipient.status}</td>
                          <td>{recipient.sentAt ? formatDateTime(recipient.sentAt) : '—'}</td>
                          <td>{recipient.errorCode ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {recipientsCursor && (
                    <button
                      className="button-secondary"
                      disabled={isLoadingMoreRecipients}
                      onClick={handleLoadMoreRecipients}
                      style={{ marginTop: 12 }}
                      type="button"
                    >
                      {isLoadingMoreRecipients ? 'Loading...' : 'Load more'}
                    </button>
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
      <div className="settings-card">
        <p className="hint-text">Loading audience...</p>
      </div>
    );
  }
  return (
    <div className="settings-card">
      <h3 style={{ margin: 0 }}>Current audience</h3>
      <div className="settings-row">
        <span className="settings-row__label">Segment matches</span>
        <span>{audience.segmentMatchCount}</span>
      </div>
      <div className="settings-row">
        <span className="settings-row__label">Telegram-eligible</span>
        <span>{audience.telegramEligibleCount}</span>
      </div>
      <div className="settings-row">
        <span className="settings-row__label">Skipped (no Telegram account)</span>
        <span>{audience.skippedCount}</span>
      </div>
      {audience.items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Eligibility</th>
            </tr>
          </thead>
          <tbody>
            {audience.items.map((candidate) => (
              <tr key={candidate.customerId}>
                <td>{candidate.displayName ?? '—'}</td>
                <td>{candidate.phone ?? '—'}</td>
                <td>{candidate.eligible ? 'Eligible' : 'Skipped — no Telegram account'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
