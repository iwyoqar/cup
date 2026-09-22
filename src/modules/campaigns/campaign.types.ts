import { CampaignChannel } from '../../common/enums/campaign-channel';
import { CampaignRecipientStatus } from '../../common/enums/campaign-recipient-status';
import { CampaignStatus } from '../../common/enums/campaign-status';

// Response shapes — never the raw Prisma model. Mirrors this project's existing convention
// (SegmentView, AdminCustomer360, ...): explicit DTOs, never leaking internal columns
// (segmentId's own FK plumbing, updatedBy, etc. beyond what's useful to the admin).

export interface CampaignRecipientStats {
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
}

export interface CampaignListItem {
  id: string;
  name: string;
  segment: { id: string; name: string };
  channel: CampaignChannel;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignListPage {
  items: CampaignListItem[];
  nextCursor: string | null;
}

export interface CampaignView {
  id: string;
  name: string;
  description: string | null;
  segment: { id: string; name: string };
  channel: CampaignChannel;
  status: CampaignStatus;
  messageText: string;
  stats: CampaignRecipientStats;
  createdAt: string;
  updatedAt: string;
}

export interface AudienceCandidateView {
  customerId: string;
  displayName: string | null;
  phone: string | null;
  eligible: boolean;
  skipReason: 'no_telegram_account' | null;
}

export interface AudiencePreviewPage {
  segmentMatchCount: number;
  telegramEligibleCount: number;
  skippedCount: number;
  items: AudienceCandidateView[];
  nextCursor: string | null;
}

export interface CampaignRecipientView {
  customerId: string;
  displayName: string | null;
  phone: string | null;
  status: CampaignRecipientStatus;
  sentAt: string | null;
  failedAt: string | null;
  errorCode: string | null;
}

export interface CampaignRecipientsPage {
  items: CampaignRecipientView[];
  nextCursor: string | null;
}
