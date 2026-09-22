import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface NewRecipientRow {
  campaignId: string;
  customerId: string;
  telegramAccountId: string | null;
  status: 'pending' | 'skipped';
  errorCode: string | null;
}

@Injectable()
export class CampaignRecipientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Bulk insert of the frozen audience — one query regardless of audience size, never a
  // per-recipient INSERT. The (campaignId, customerId) unique constraint (schema.prisma) is the
  // final guard against ever double-creating a recipient row for the same campaign.
  createMany(rows: NewRecipientRow[]) {
    if (rows.length === 0) {
      return Promise.resolve({ count: 0 });
    }
    return this.prisma.campaignRecipient.createMany({ data: rows });
  }

  // Looked up by (campaignId, customerId) rather than the recipient row's own id — the sender
  // never needs to know CampaignRecipient.id, since it already has the {customerId, chatId}
  // pairs in memory from the same freeze step that created these rows (see
  // campaign-audience.service.ts). updateMany is safe here specifically because of the unique
  // constraint: at most one row can ever match.
  markSent(campaignId: string, customerId: string, telegramMessageId: string) {
    return this.prisma.campaignRecipient.updateMany({
      where: { campaignId, customerId },
      data: { status: 'sent', telegramMessageId, sentAt: new Date() },
    });
  }

  markFailed(campaignId: string, customerId: string, errorCode: string) {
    return this.prisma.campaignRecipient.updateMany({
      where: { campaignId, customerId },
      data: { status: 'failed', errorCode, failedAt: new Date(), attempts: { increment: 1 } },
    });
  }

  // Deliberately no "mark uncertain" / "mark pending" method: a row is already created as
  // 'pending', and an uncertain send outcome is a NO-OP against this table — the row is simply
  // left exactly as it was. See campaign-messaging.service.ts.

  list(campaignId: string, options: { cursor?: string; take: number }) {
    return this.prisma.campaignRecipient.findMany({
      where: { campaignId },
      orderBy: { id: 'asc' },
      take: options.take,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: { customer: { select: { displayName: true, phone: true } } },
    });
  }

  // One bounded groupBy, never a per-status count query — used for the campaign detail view's
  // delivery statistics (spec: "Recipients / Sent / Failed / Skipped").
  async getStats(campaignId: string): Promise<{ pending: number; sent: number; failed: number; skipped: number }> {
    const grouped = await this.prisma.campaignRecipient.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { _all: true },
    });
    const stats = { pending: 0, sent: 0, failed: 0, skipped: 0 };
    for (const row of grouped) {
      if (row.status in stats) {
        stats[row.status as keyof typeof stats] = row._count._all;
      }
    }
    return stats;
  }
}
