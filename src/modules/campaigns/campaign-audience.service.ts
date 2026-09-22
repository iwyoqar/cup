import { Injectable } from '@nestjs/common';
import { SegmentsService } from '../segments/segments.service';
import { TelegramAccountsRepository } from '../telegram-accounts/telegram-accounts.repository';
import { AudienceCandidateView, AudiencePreviewPage } from './campaign.types';
import { CampaignAudienceRepository } from './campaign-audience.repository';
import { CampaignRecipientsRepository } from './campaign-recipients.repository';

interface AudienceCandidate {
  customerId: string;
  displayName: string | null;
  phone: string | null;
  eligible: boolean;
  skipReason: 'no_telegram_account' | null;
  chatId: string | null;
  telegramAccountId: string | null;
}

export interface FrozenAudience {
  sendTargets: { customerId: string; chatId: string }[];
}

// Resolves WHO a campaign's audience is — segment membership (via SegmentsService, never a
// second segment evaluator) crossed with Telegram eligibility (via TelegramAccountsRepository,
// bulk). Deliberately knows nothing about Telegram SENDING itself (that's
// TelegramMessagingService/CampaignMessagingService) or campaign lifecycle state (that's
// CampaignsService) — see this phase's one-directional dependency diagram:
// CampaignService -> CampaignAudienceService -> SegmentsService -> CustomerMetricsService -> LoyaltyService.
//
// Eligibility today has exactly one possible reason to be ineligible: no TelegramAccount row at
// all. The spec's other example reasons ("incomplete registration", "inactive account") aren't
// modeled by the current schema — a TelegramAccount is only ever created with a full profile in
// one atomic step (see telegram-identity.service.ts), and there is no "blocked"/"inactive" flag
// on it; a blocked bot only becomes visible as an actual send failure (see
// campaign-messaging.service.ts), which is a CampaignRecipient-level 'failed' outcome, not a
// pre-send eligibility state. Not guessing at fields that don't exist, per this phase's explicit
// instruction.
@Injectable()
export class CampaignAudienceService {
  constructor(
    private readonly segmentsService: SegmentsService,
    private readonly telegramAccountsRepository: TelegramAccountsRepository,
    private readonly repository: CampaignAudienceRepository,
    private readonly recipientsRepository: CampaignRecipientsRepository,
  ) {}

  // Read-only, safe to call any number of times: never creates CampaignRecipient rows, never
  // sends anything, never mutates customer/Telegram/segment data. Returns null only when the
  // segment no longer resolves (shouldn't happen in practice once a Campaign exists — the
  // database itself blocks deleting a Segment a Campaign still references — but handled
  // defensively rather than assumed).
  async previewAudience(segmentId: string, options: { cursor?: string; limit: number }): Promise<AudiencePreviewPage | null> {
    const candidates = await this.resolveCandidates(segmentId);
    if (candidates === null) {
      return null;
    }

    const sorted = [...candidates].sort((a, b) => (a.customerId < b.customerId ? -1 : a.customerId > b.customerId ? 1 : 0));
    const cursorIndex = options.cursor ? sorted.findIndex((c) => c.customerId === options.cursor) : -1;
    const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const page = sorted.slice(startIndex, startIndex + options.limit + 1);
    const hasMore = page.length > options.limit;
    const pageTrimmed = hasMore ? page.slice(0, options.limit) : page;

    return {
      segmentMatchCount: candidates.length,
      telegramEligibleCount: candidates.filter((c) => c.eligible).length,
      skippedCount: candidates.filter((c) => !c.eligible).length,
      items: pageTrimmed.map(toAudienceCandidateView),
      nextCursor: hasMore ? pageTrimmed[pageTrimmed.length - 1].customerId : null,
    };
  }

  // Called ONLY from CampaignsService.send(), AFTER the campaign's draft->sending claim has
  // already been atomically acquired — that claim is what guarantees this runs at most once per
  // campaign, so it's safe to create the frozen CampaignRecipient rows here without any
  // additional locking of its own. Returns the {customerId, chatId} pairs needed to actually
  // send, taken straight from the in-memory resolution rather than re-querying TelegramAccount a
  // second time.
  async freezeAudience(campaignId: string, segmentId: string): Promise<FrozenAudience> {
    const candidates = await this.resolveCandidates(segmentId);
    // Not expected in practice (see class comment), but fail loudly rather than silently
    // freezing an empty audience if it somehow happens.
    if (candidates === null) {
      throw new Error(`Segment ${segmentId} referenced by campaign ${campaignId} no longer exists.`);
    }

    await this.recipientsRepository.createMany(
      candidates.map((c) => ({
        campaignId,
        customerId: c.customerId,
        telegramAccountId: c.telegramAccountId,
        status: c.eligible ? ('pending' as const) : ('skipped' as const),
        errorCode: c.eligible ? null : c.skipReason,
      })),
    );

    return {
      sendTargets: candidates
        .filter((c): c is AudienceCandidate & { chatId: string } => c.eligible && c.chatId !== null)
        .map((c) => ({ customerId: c.customerId, chatId: c.chatId })),
    };
  }

  private async resolveCandidates(segmentId: string): Promise<AudienceCandidate[] | null> {
    const matchingIds = await this.segmentsService.getAllMatchingCustomerIds(segmentId);
    if (matchingIds === null) {
      return null;
    }
    if (matchingIds.length === 0) {
      return [];
    }

    const [profiles, telegramAccounts] = await Promise.all([
      this.repository.findCustomerProfilesByIds(matchingIds),
      this.telegramAccountsRepository.findByCustomerIds(matchingIds),
    ]);
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const telegramByCustomerId = new Map(telegramAccounts.map((t) => [t.customerId, t]));

    return matchingIds.map((customerId) => {
      const profile = profileById.get(customerId);
      const telegram = telegramByCustomerId.get(customerId);
      return {
        customerId,
        displayName: profile?.displayName ?? null,
        phone: profile?.phone ?? null,
        eligible: Boolean(telegram),
        skipReason: telegram ? null : ('no_telegram_account' as const),
        chatId: telegram?.chatId ?? null,
        telegramAccountId: telegram?.id ?? null,
      };
    });
  }
}

function toAudienceCandidateView(candidate: AudienceCandidate): AudienceCandidateView {
  return {
    customerId: candidate.customerId,
    displayName: candidate.displayName,
    phone: candidate.phone,
    eligible: candidate.eligible,
    skipReason: candidate.skipReason,
  };
}
