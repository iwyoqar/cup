import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PosterImportModule } from '../poster-import/poster-import.module';
import { PosterModule } from '../poster/poster.module';
import { SettingsModule } from '../settings/settings.module';
import { PosterReconcileService } from './poster-reconcile.service';
import { PosterSyncAdminController } from './poster-sync-admin.controller';
import { PosterSyncProcessorService } from './poster-sync-processor.service';
import { PosterSyncRepository } from './poster-sync.repository';
import { PosterSyncScheduler } from './poster-sync.scheduler';
import { PosterWebhookController } from './poster-webhook.controller';
import { PosterWebhookService } from './poster-webhook.service';

// Phase 20 — Poster webhook continuous sync. Reuses the Phase 19 import engine (no second engine); adds only the durable queue, the receiver, the processor and
// the reconciliation loop. Ships OFF (POSTER_SYNC_ENABLED).
@Module({
  imports: [AdminAuthModule, PosterModule, PosterImportModule, SettingsModule],
  controllers: [PosterWebhookController, PosterSyncAdminController],
  providers: [PosterSyncRepository, PosterWebhookService, PosterSyncProcessorService, PosterReconcileService, PosterSyncScheduler],
})
export class PosterSyncModule {}
