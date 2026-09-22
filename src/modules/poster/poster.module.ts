import { Module } from '@nestjs/common';
import { PosterClientsService } from './poster-clients.service';
import { PosterService } from './poster.service';

@Module({
  providers: [PosterService, PosterClientsService],
  exports: [PosterService, PosterClientsService],
})
export class PosterModule {}
