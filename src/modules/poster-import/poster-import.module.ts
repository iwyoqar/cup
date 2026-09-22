import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PosterModule } from '../poster/poster.module';
import { PosterImportController } from './poster-import.controller';
import { PosterImportHistoryService } from './poster-import-history.service';
import { PosterImportQualityService } from './poster-import-quality.service';
import { PosterImportReportRepository } from './poster-import-report.repository';
import { PosterImportRepository } from './poster-import.repository';
import { PosterImportedActivityService } from './poster-imported-activity.service';
import { PosterSpotMappingService } from './poster-spot-mapping.service';
import { PosterTransactionImportService } from './poster-transaction-import.service';

@Module({
  imports: [AdminAuthModule, PosterModule],
  controllers: [PosterImportController],
  providers: [
    PosterImportRepository,
    PosterImportReportRepository,
    PosterTransactionImportService,
    PosterImportedActivityService,
    PosterSpotMappingService,
    PosterImportQualityService,
    PosterImportHistoryService,
  ],
  exports: [PosterImportedActivityService, PosterTransactionImportService, PosterImportRepository],
})
export class PosterImportModule {}
