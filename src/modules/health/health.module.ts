import { Module } from '@nestjs/common';
import { PosterModule } from '../poster/poster.module';
import { HealthController } from './health.controller';

@Module({
  imports: [PosterModule],
  controllers: [HealthController],
})
export class HealthModule {}
