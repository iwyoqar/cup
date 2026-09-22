import { Module } from '@nestjs/common';
import { PosterModule } from '../poster/poster.module';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';
import { CatalogSyncJob } from './catalog-sync.job';

@Module({
  imports: [PosterModule],
  controllers: [CatalogController],
  providers: [CatalogService, CatalogRepository, CatalogSyncJob],
  exports: [CatalogRepository, CatalogService],
})
export class CatalogModule {}
