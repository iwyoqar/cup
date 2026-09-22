import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface SaveCampaignData {
  name: string;
  description: string | null;
  segmentId: string;
  messageText: string;
}

const LIST_INCLUDE = { segment: { select: { id: true, name: true } } } as const;

@Injectable()
export class CampaignsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(options: { cursor?: string; take: number }) {
    return this.prisma.campaign.findMany({
      orderBy: { updatedAt: 'desc' },
      take: options.take,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: LIST_INCLUDE,
    });
  }

  findById(id: string) {
    return this.prisma.campaign.findUnique({ where: { id }, include: LIST_INCLUDE });
  }

  create(data: SaveCampaignData & { createdBy: string | null }) {
    return this.prisma.campaign.create({
      data: {
        name: data.name,
        description: data.description,
        segmentId: data.segmentId,
        messageText: data.messageText,
        createdBy: data.createdBy,
        updatedBy: data.createdBy,
      },
      include: LIST_INCLUDE,
    });
  }

  update(id: string, data: Partial<SaveCampaignData> & { updatedBy: string | null }) {
    return this.prisma.campaign.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.segmentId !== undefined ? { segmentId: data.segmentId } : {}),
        ...(data.messageText !== undefined ? { messageText: data.messageText } : {}),
        updatedBy: data.updatedBy,
      },
      include: LIST_INCLUDE,
    });
  }

  delete(id: string) {
    return this.prisma.campaign.delete({ where: { id } });
  }

  // THE concurrency guard for send (spec's "Send Safety" section): a single conditional UPDATE
  // is atomic at the database level — only the caller whose WHERE clause still matched a
  // 'draft' row at execution time affects a row and gets count > 0 back. Any concurrent second
  // request (a genuine double-click, or two admins) sees count === 0 and must not proceed. Same
  // "let the database itself be the lock" philosophy as OrderStatusNotification's unique-
  // constraint claim (schema.prisma), just via a compare-and-swap UPDATE instead of an INSERT,
  // since here there's an existing row whose STATE is what's being atomically claimed.
  async claimForSending(id: string, updatedBy: string | null): Promise<boolean> {
    const result = await this.prisma.campaign.updateMany({
      where: { id, status: 'draft' },
      data: { status: 'sending', updatedBy },
    });
    return result.count > 0;
  }

  markCompleted(id: string) {
    return this.prisma.campaign.update({ where: { id }, data: { status: 'completed' } });
  }

  // Only for a genuine execution failure (see schema.prisma's comment on Campaign.status) — not
  // called merely because some recipients failed to receive their message.
  markFailed(id: string) {
    return this.prisma.campaign.update({ where: { id }, data: { status: 'failed' } });
  }
}
