import { useEffect, useState } from 'react';
import { createCampaign, CampaignInput, updateCampaign } from '../lib/adminCampaigns';
import { ApiError } from '../lib/api';
import { fetchSegments } from '../lib/adminSegments';
import { Campaign, Segment } from '../lib/types';
import { Button } from '../ui';

const MAX_MESSAGE_LENGTH = 4096; // Telegram's own hard sendMessage limit — mirrors campaigns.dto.ts.

interface CampaignFormProps {
  existing?: Campaign; // present when editing (only ever a draft — see CampaignDetailView), absent when creating.
  onSaved: (campaign: Campaign) => void;
  onCancel: () => void;
}

// Create/edit only — this form NEVER sends a campaign. Save always results in (or keeps) a
// draft; sending is a separate, explicit confirmation step reached from CampaignDetailView (spec's
// "the Admin UI must not send directly from the campaign form" requirement).
export function CampaignForm({ existing, onSaved, onCancel }: CampaignFormProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [segmentId, setSegmentId] = useState(existing?.segment.id ?? '');
  const [messageText, setMessageText] = useState(existing?.messageText ?? '');
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchSegments()
      .then((page) => setSegments(page.items.filter((s) => s.isActive)))
      .catch(() => setSegments([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (name.trim().length === 0) {
      setError('Name is required.');
      return;
    }
    if (segmentId.trim().length === 0) {
      setError('Select a segment.');
      return;
    }
    if (messageText.trim().length === 0) {
      setError('Message text is required.');
      return;
    }
    if (messageText.length > MAX_MESSAGE_LENGTH) {
      setError(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
      return;
    }

    setIsSaving(true);
    try {
      const input: CampaignInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        segmentId,
        messageText,
      };
      const saved = existing ? await updateCampaign(existing.id, input) : await createCampaign(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to save campaign.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>{existing ? 'Edit campaign' : 'Create campaign'}</h1>

      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted max-w-[420px]">
        <label htmlFor="campaign-name">Name</label>
        <input id="campaign-name" onChange={(e) => setName(e.target.value)} type="text" value={name} />
      </div>

      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted max-w-[420px]">
        <label htmlFor="campaign-description">Description</label>
        <input id="campaign-description" onChange={(e) => setDescription(e.target.value)} type="text" value={description} />
      </div>

      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted max-w-[420px]">
        <label htmlFor="campaign-segment">Segment</label>
        {segments === null ? (
          <p className="text-[13px] leading-snug text-muted">Loading segments...</p>
        ) : segments.length === 0 ? (
          <p className="text-[13px] leading-snug text-muted">No active segments available. Create one under Segments first.</p>
        ) : (
          <select id="campaign-segment" onChange={(e) => setSegmentId(e.target.value)} value={segmentId}>
            <option value="">Select a segment</option>
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted max-w-[520px]">
        <label htmlFor="campaign-message">Message (Telegram, plain text)</label>
        <textarea
          id="campaign-message"
          onChange={(e) => setMessageText(e.target.value)}
          rows={6}
          value={messageText}
        />
        <span className={messageText.length > MAX_MESSAGE_LENGTH ? 'text-[13px] font-semibold text-err' : 'text-[13px] leading-snug text-muted'}>
          {messageText.length} / {MAX_MESSAGE_LENGTH}
        </span>
      </div>

      {error && (
        <p className="text-[13px] font-semibold text-err mt-4">
          {error}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button disabled={isSaving} type="submit" variant="primary">
          {isSaving ? 'Saving...' : 'Save draft'}
        </Button>
        <Button disabled={isSaving} onClick={onCancel} variant="secondary">
          Cancel
        </Button>
      </div>
    </form>
  );
}
