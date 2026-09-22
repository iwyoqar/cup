import { Module } from '@nestjs/common';
import { PosterModule } from '../poster/poster.module';
import { BranchController } from './branch.controller';
import { BranchRepository } from './branch.repository';
import { BranchService } from './branch.service';

@Module({
  imports: [PosterModule],
  controllers: [BranchController],
  providers: [BranchService, BranchRepository],
  exports: [BranchRepository, BranchService],
})
export class BranchModule {}
