import { BadRequestException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ConfigService } from '../../common/config/config.service';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { isAdminRole } from '../staff/staff-roles';
import { PosterReconcileService } from './poster-reconcile.service';
import { PosterSyncRepository } from './poster-sync.repository';
import { PosterWebhookService } from './poster-webhook.service';

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    status: z.enum(['QUEUED', 'PROCESSING', 'DONE', 'DEAD']).optional(),
    transactionId: z.string().regex(/^\d{1,12}$/).optional(),
  })
  .strict();

const ID = /^[A-Za-z0-9_-]{1,64}$/;

// Admin-only visibility over the continuous sync. Read-only except the retry of a DEAD event, which only re-queues it (the processing itself stays behind the
// operator flag). Nothing here returns the application secret, the Poster token, customer data or any receipt content.
@UseGuards(AdminAuthGuard)
@Controller('admin/poster')
export class PosterSyncAdminController {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: PosterSyncRepository,
    private readonly reconcile: PosterReconcileService,
    private readonly webhook: PosterWebhookService,
  ) {}

  @Get('sync-status')
  async status(@CurrentAdmin() admin: { role: string }) {
    if (!isAdminRole(admin.role)) throw new ForbiddenException('Admin role required.');
    const env = this.config.env;
    const now = new Date();
    const [stats, recon] = await Promise.all([this.repository.stats(now), this.reconcile.snapshot(now)]);
    const reconcile = recon.last;
    const oldestAgeSeconds = stats.queue.oldestQueuedSince ? Math.max(0, Math.round((now.getTime() - stats.queue.oldestQueuedSince.getTime()) / 1000)) : null;

    const alerts: string[] = [];
    if (!env.POSTER_APPLICATION_SECRET) alerts.push('POSTER_APPLICATION_SECRET is not set: the webhook endpoint answers 503 and stores nothing.');
    if (!env.POSTER_SYNC_ENABLED) alerts.push('POSTER_SYNC_ENABLED is off: events are queued but nothing is imported and the reconciliation loop is not running.');
    if (stats.queue.dead > 0) alerts.push(`${stats.queue.dead} event(s) are DEAD (retries exhausted) — check the cause and retry them.`);
    if (env.POSTER_SYNC_ENABLED && oldestAgeSeconds !== null && oldestAgeSeconds > 900) alerts.push(`The oldest queued event has been waiting ${Math.round(oldestAgeSeconds / 60)} min.`);
    const lagLimitSeconds = (env.POSTER_RECONCILE_INTERVAL_MS * 3) / 1000 + env.POSTER_RECONCILE_OVERLAP_MINUTES * 60;
    if (env.POSTER_SYNC_ENABLED && !recon.checkpoint) alerts.push('The reconciliation has no checkpoint yet (it has not completed a first pass).');
    if (env.POSTER_SYNC_ENABLED && recon.lagSeconds !== null && recon.lagSeconds > lagLimitSeconds) alerts.push(`The reconciliation checkpoint is ${formatLag(recon.lagSeconds)} behind — it is catching up or something keeps failing.`);
    if (recon.lastError && !recon.lastError.resolved) alerts.push(`The last reconciliation failed at ${recon.lastError.at}: ${recon.lastError.message} The checkpoint was NOT advanced and the next pass resumes from it.`);
    if (reconcile?.blockedBy && reconcile.ok) alerts.push(`The reconciliation checkpoint is held: ${reconcile.blockedBy}.`);
    if (reconcile && reconcile.missedWebhooks > 0) alerts.push(`Reconciliation recovered ${reconcile.missedWebhooks} receipt(s) that no webhook had announced — the webhook delivery is losing events.`);
    if (stats.removedButImported.length > 0) alerts.push(`Poster reports receipt(s) #${stats.removedButImported.join(', #')} as removed but they are imported in CUP — review manually (nothing is reversed automatically).`);

    return {
      generatedAt: now.toISOString(),
      config: {
        syncEnabled: env.POSTER_SYNC_ENABLED,
        applicationSecretConfigured: !!env.POSTER_APPLICATION_SECRET,
        accountPinned: !!env.POSTER_ACCOUNT,
        webhookPath: '/webhooks/poster',
        tickSeconds: Math.round(env.POSTER_SYNC_TICK_MS / 1000),
        reconcileMinutes: Math.round(env.POSTER_RECONCILE_INTERVAL_MS / 60000),
        reconcileLookbackDays: env.POSTER_RECONCILE_LOOKBACK_DAYS,
        reconcileOverlapMinutes: env.POSTER_RECONCILE_OVERLAP_MINUTES,
        maxAttempts: env.POSTER_WEBHOOK_MAX_ATTEMPTS,
        settleSeconds: env.POSTER_IMPORT_SETTLE_SECONDS,
      },
      queue: { ...stats.queue, oldestQueuedSince: undefined, oldestQueuedAgeSeconds: oldestAgeSeconds },
      webhooks: { lastReceivedAt: stats.lastReceivedAt, received24h: stats.received24h, duplicateDeliveries24h: stats.duplicateDeliveries24h, ...this.webhook.counters() },
      processing: { lastProcessedAt: stats.lastProcessedAt, outcomes24h: stats.outcomes24h },
      reconciliation: recon,
      removedButImported: stats.removedButImported,
      alerts,
    };
  }

  @Get('webhook-events')
  async events(@Query() query: Record<string, string | undefined>, @CurrentAdmin() admin: { role: string }) {
    if (!isAdminRole(admin.role)) throw new ForbiddenException('Admin role required.');
    const parsed = listQuery.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid webhook-events query.');
    const q = parsed.data;
    const { total, rows } = await this.repository.list({ status: q.status, objectId: q.transactionId }, (q.page - 1) * q.pageSize, q.pageSize);
    return {
      page: q.page,
      pageSize: q.pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / q.pageSize)),
      items: rows.map((r) => ({ id: r.id, object: r.object, transactionId: r.objectId, action: r.action, eventAt: r.eventAt.toISOString(), status: r.status, deliveries: r.deliveries, attempts: r.attempts, nextAttemptAt: r.nextAttemptAt.toISOString(), outcome: r.outcome, lastError: r.lastError, receivedAt: r.receivedAt.toISOString(), processedAt: r.processedAt?.toISOString() ?? null })),
    };
  }

  @Post('webhook-events/:id/retry')
  async retry(@Param('id') id: string, @CurrentAdmin() admin: { role: string }) {
    if (!isAdminRole(admin.role)) throw new ForbiddenException('Admin role required.');
    if (!ID.test(id)) throw new BadRequestException('Invalid event id.');
    const moved = await this.repository.requeueDead(id, new Date());
    if (!moved) throw new NotFoundException('No DEAD event with that id.');
    return { requeued: true };
  }
}

function formatLag(seconds: number): string {
  if (seconds >= 86400) return `${(seconds / 86400).toFixed(1)} day(s)`;
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} h`;
  return `${Math.round(seconds / 60)} min`;
}
