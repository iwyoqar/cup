import { BadRequestException, Injectable } from '@nestjs/common';
import { isForeignKeyConstraintViolation } from '../../common/util/prisma-errors';
import { CampaignChannel } from '../../common/enums/campaign-channel';
import { CampaignRecipientStatus } from '../../common/enums/campaign-recipient-status';
import { CampaignStatus } from '../../common/enums/campaign-status';
import { SegmentsService } from '../segments/segments.service';
import { CampaignAudienceService } from './campaign-audience.service';
import { AudiencePreviewPage, CampaignListItem, CampaignListPage, CampaignRecipientsPage, CampaignView } from './campaign.types';
import { CampaignMessagingService } from './campaign-messaging.service';
import { CampaignRecipientsRepository } from './campaign-recipients.repository';
import { CreateCampaignInput, UpdateCampaignInput } from './campaigns.dto';
import { CampaignAlreadySendingError, CampaignNotDeletableError, CampaignNotEditableError, CampaignNotFoundError } from './campaigns.errors';
import { CampaignsRepository } from './campaigns.repository';

interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  segmentId: string;
  segment: { id: string; name: string };
  channel: string;
  status: string;
  messageText: string;
  createdAt: Date;
  updatedAt: Date;
}

// Orchestrates the campaign lifecycle end to end. Deliberately the only place that touches BOTH
// CampaignAudienceService (segment -> audience) and CampaignMessagingService (audience -> sent
// messages) — see this phase's one-directional dependency diagram. Every business-rule decision
// about WHEN a campaign may be edited/deleted/sent lives here, never in the controller.
@Injectable()
export class CampaignsService {
  constructor(
    private readonly repository: CampaignsRepository,
    private readonly recipientsRepository: CampaignRecipientsRepository,
    private readonly segmentsService: SegmentsService,
    private readonly campaignAudienceService: CampaignAudienceService,
    private readonly campaignMessagingService: CampaignMessagingService,
  ) {}

  async list(options: { cursor?: string; limit: number }): Promise<CampaignListPage> {
    const rows = await this.repository.findMany({ cursor: options.cursor, take: options.limit + 1 });
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      items: pageRows.map(toCampaignListItem),
      nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    };
  }

  async getById(id: string): Promise<CampaignView | null> {
    const row = await this.repository.findById(id);
    if (!row) {
      return null;
    }
    const stats = await this.recipientsRepository.getStats(id);
    return toCampaignView(row, stats);
  }

  async create(input: CreateCampaignInput, adminId: string): Promise<CampaignView> {
    await this.assertSegmentExists(input.segmentId);
    const created = await this.repository.create({
      name: input.name,
      description: input.description ?? null,
      segmentId: input.segmentId,
      messageText: input.messageText,
      createdBy: adminId,
    });
    return toCampaignView(created, ZERO_STATS);
  }

  // "Only draft campaigns may be edited" (spec's Campaign CRUD section) — a campaign that has
  // started sending or finished must never have its segment/message silently change out from
  // under its already-frozen (or in-progress) recipient set.
  async update(id: string, input: UpdateCampaignInput, adminId: string): Promise<CampaignView> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new CampaignNotFoundError();
    }
    if (existing.status !== 'draft') {
      throw new CampaignNotEditableError();
    }
    if (input.segmentId !== undefined) {
      await this.assertSegmentExists(input.segmentId);
    }
    const updated = await this.repository.update(id, {
      name: input.name,
      description: input.description,
      segmentId: input.segmentId,
      messageText: input.messageText,
      updatedBy: adminId,
    });
    const stats = await this.recipientsRepository.getStats(id);
    return toCampaignView(updated, stats);
  }

  // "Only draft campaigns may be deleted... do not delete completed campaign history" (spec).
  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new CampaignNotFoundError();
    }
    if (existing.status !== 'draft') {
      throw new CampaignNotDeletableError();
    }
    try {
      await this.repository.delete(id);
    } catch (err) {
      // Phase 13: a campaign an automation still references is protected by the database (FK RESTRICT) — same clean 409 as a non-draft.
      if (isForeignKeyConstraintViolation(err)) throw new CampaignNotDeletableError();
      throw err;
    }
  }

  // Read-only preview — never creates CampaignRecipient rows, never sends, never mutates
  // anything. Always resolves the CURRENT segment membership, regardless of campaign status (an
  // admin may want to see the current audience for a completed campaign too, for reference).
  async getAudiencePreview(id: string, options: { cursor?: string; limit: number }): Promise<AudiencePreviewPage | null> {
    const campaign = await this.repository.findById(id);
    if (!campaign) {
      return null;
    }
    return this.campaignAudienceService.previewAudience(campaign.segmentId, options);
  }

  async getRecipients(id: string, options: { cursor?: string; limit: number }): Promise<CampaignRecipientsPage | null> {
    const campaign = await this.repository.findById(id);
    if (!campaign) {
      return null;
    }
    const rows = await this.recipientsRepository.list(id, { cursor: options.cursor, take: options.limit + 1 });
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      items: pageRows.map((row) => ({
        customerId: row.customerId,
        displayName: row.customer.displayName,
        phone: row.customer.phone,
        status: row.status as CampaignRecipientStatus,
        sentAt: row.sentAt ? row.sentAt.toISOString() : null,
        failedAt: row.failedAt ? row.failedAt.toISOString() : null,
        errorCode: row.errorCode,
      })),
      nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    };
  }

  // The full send flow (spec's "Recipient Snapshot" steps 1-12), condensed to what actually
  // needs to happen once the atomic claim (step 6) has been acquired: everything before it is
  // just validation, everything after it is a one-way door for this campaign (no resend).
  async send(id: string, adminId: string): Promise<CampaignView> {
    const campaign = await this.repository.findById(id);
    if (!campaign) {
      throw new CampaignNotFoundError();
    }
    if (campaign.status !== 'draft') {
      // Gives a clean, immediate error for the common case (already sent/sending). The atomic
      // claim just below is what actually adjudicates a genuine race between two concurrent
      // requests — this check alone is not the concurrency guard.
      throw new CampaignAlreadySendingError();
    }
    if (campaign.messageText.trim().length === 0) {
      // Defensive re-check (spec step 5: "Validate message") — should be unreachable in
      // practice since create/update already enforce this, but a campaign's message must never
      // be sent empty regardless of how that state could theoretically occur.
      throw new BadRequestException('Campaign message is empty.');
    }

    // Reuses the existing updatedBy column (spec's Auditability section: "reuse the same
    // pattern" rather than a new audit-log subsystem) to record which admin triggered the send,
    // atomically with the claim itself.
    const claimed = await this.repository.claimForSending(id, adminId);
    if (!claimed) {
      // Someone else (a double-click, or a second admin) won the race for this exact campaign.
      throw new CampaignAlreadySendingError();
    }

    try {
      const audience = await this.campaignAudienceService.freezeAudience(id, campaign.segmentId);
      await this.campaignMessagingService.sendToRecipients(id, audience.sendTargets, campaign.messageText);
      await this.repository.markCompleted(id);
    } catch (err) {
      // A genuine execution failure — e.g. the audience couldn't be resolved/frozen at all —
      // not merely "some recipients failed" (that's reflected in per-recipient stats instead,
      // and still results in 'completed'). See schema.prisma's comment on Campaign.status.
      await this.repository.markFailed(id);
      throw err;
    }

    const stats = await this.recipientsRepository.getStats(id);
    const finalRow = await this.repository.findById(id);
    return toCampaignView(finalRow!, stats);
  }

  private async assertSegmentExists(segmentId: string): Promise<void> {
    const segment = await this.segmentsService.getById(segmentId);
    if (!segment) {
      throw new BadRequestException(`Segment "${segmentId}" not found.`);
    }
  }
}

const ZERO_STATS = { pending: 0, sent: 0, failed: 0, skipped: 0 };

function toCampaignListItem(row: CampaignRow): CampaignListItem {
  return {
    id: row.id,
    name: row.name,
    segment: row.segment,
    channel: row.channel as CampaignChannel,
    status: row.status as CampaignStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCampaignView(row: CampaignRow, stats: { pending: number; sent: number; failed: number; skipped: number }): CampaignView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    segment: row.segment,
    channel: row.channel as CampaignChannel,
    status: row.status as CampaignStatus,
    messageText: row.messageText,
    stats,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
