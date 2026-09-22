import { Controller, Get, Post } from '@nestjs/common';
import { BranchService } from './branch.service';

@Controller('branches')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @Post('sync')
  sync() {
    return this.branchService.sync();
  }

  // Matches docs/PHASE-1-DESIGN.md section 9's contract exactly: {id, name, address,
  // isActive} only. posterSpotId/syncedAt are CUP-internal bookkeeping — not exposed to the
  // Mini App per "do not expose unnecessary Poster fields".
  @Get()
  async list() {
    const branches = await this.branchService.listActive();
    return branches.map((b) => ({ id: b.id, name: b.name, address: b.address, isActive: b.isActive }));
  }
}
