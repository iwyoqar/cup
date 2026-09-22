import { useEffect, useState } from 'react';
import { fetchCampaigns } from '../lib/adminCampaigns';
import { ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { Campaign, CampaignListItem } from '../lib/types';
import { CampaignForm } from '../components/CampaignForm';
import { CampaignDetailView } from '../components/CampaignDetailView';

import { findNav } from '../lib/nav';
import { Column, DataTable, EmptyState, ErrorState, LoadingState, PageHeader, SectionCard, StatusBadge } from '../ui';
import type { BadgeTone } from '../ui';

// Restrained status tones: a draft is quiet, a finished send is calm green, a failure stands out.
const CAMPAIGN_TONE: Record<string, BadgeTone> = { draft: 'neutral', sending: 'info', completed: 'ok', failed: 'err' };

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; campaign: Campaign } | { kind: 'detail'; campaignId: string };

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sending: 'Sending…',
  completed: 'Completed',
  failed: 'Failed',
};

export function CampaignsPage() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [items, setItems] = useState<CampaignListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const loadList = () => {
    setItems(null);
    setError(null);
    fetchCampaigns()
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load campaigns.'));
  };

  useEffect(() => {
    if (view.kind === 'list') {
      loadList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind]);

  const handleLoadMore = async () => {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const page = await fetchCampaigns(nextCursor);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to load more campaigns.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (view.kind === 'create') {
    return (
      <CampaignForm
        onCancel={() => setView({ kind: 'list' })}
        onSaved={(saved) => setView({ kind: 'detail', campaignId: saved.id })}
      />
    );
  }

  if (view.kind === 'edit') {
    return (
      <CampaignForm
        existing={view.campaign}
        onCancel={() => setView({ kind: 'detail', campaignId: view.campaign.id })}
        onSaved={(saved) => setView({ kind: 'detail', campaignId: saved.id })}
      />
    );
  }

  if (view.kind === 'detail') {
    return (
      <CampaignDetailView
        campaignId={view.campaignId}
        onBack={() => setView({ kind: 'list' })}
        onDeleted={() => setView({ kind: 'list' })}
        onEdit={(campaign) => setView({ kind: 'edit', campaign })}
      />
    );
  }

  const columns: Column<CampaignListItem>[] = [
    { key: 'name', header: 'Campaign', cell: (campaign) => <span className="table__primary">{campaign.name}</span> },
    { key: 'segment', header: 'Audience', cell: (campaign) => campaign.segment.name },
    { key: 'channel', header: 'Channel', low: true, cell: () => 'Telegram' },
    { key: 'status', header: 'Status', cell: (campaign) => <StatusBadge dot tone={CAMPAIGN_TONE[campaign.status] ?? 'neutral'}>{STATUS_LABELS[campaign.status] ?? campaign.status}</StatusBadge> },
    { key: 'created', header: 'Created', low: true, cell: (campaign) => formatDate(campaign.createdAt) },
    { key: 'updated', header: 'Updated', low: true, cell: (campaign) => formatDate(campaign.updatedAt) },
  ];

  return (
    <>
      <PageHeader
        actions={
          <button className="button-primary" onClick={() => setView({ kind: 'create' })} type="button">
            + Create campaign
          </button>
        }
        description={findNav('campaigns').item.description}
        title={findNav('campaigns').item.label}
      />

      {error && <ErrorState message={error} title="Campaigns could not be loaded" />}

      <SectionCard
        description="Select a campaign to review its audience, message, delivery and results."
        flush
        footer={
          nextCursor ? (
            <button className="button-secondary" disabled={isLoadingMore} onClick={handleLoadMore} type="button">
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </button>
          ) : undefined
        }
        title="Campaigns"
      >
        {items === null && !error ? (
          <LoadingState variant="table" />
        ) : (
          <DataTable
            columns={columns}
            empty={
              <EmptyState
                action={
                  <button className="button-primary" onClick={() => setView({ kind: 'create' })} type="button">
                    + Create campaign
                  </button>
                }
                text="A campaign sends one message to a segment of customers. Create a segment first if you have none, then compose the campaign."
                title="No campaigns yet"
                variant="block"
              />
            }
            onRowClick={(campaign) => setView({ kind: 'detail', campaignId: campaign.id })}
            rowKey={(campaign) => campaign.id}
            rows={items ?? []}
          />
        )}
      </SectionCard>
    </>
  );
}
