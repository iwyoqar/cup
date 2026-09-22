import { Injectable, Logger } from '@nestjs/common';
import { PosterService } from '../poster/poster.service';
import { PosterSpot } from '../poster/poster.types';
import { BranchRepository } from './branch.repository';

export interface BranchSyncResult {
  branchesSynced: number;
  branchesSkipped: { posterSpotId: string; reason: string }[];
}

@Injectable()
export class BranchService {
  private readonly logger = new Logger(BranchService.name);

  constructor(
    private readonly poster: PosterService,
    private readonly branchRepository: BranchRepository,
  ) {}

  async sync(): Promise<BranchSyncResult> {
    const spots = await this.poster.getSpots();

    const branchesSkipped: { posterSpotId: string; reason: string }[] = [];
    let branchesSynced = 0;

    for (const spot of spots) {
      try {
        const posterSpotId = this.extractPosterSpotId(spot);
        this.validateSpotName(spot);
        await this.branchRepository.upsertBranch({
          posterSpotId,
          name: spot.spot_name,
          address: spot.spot_adress ? spot.spot_adress : null,
        });
        branchesSynced += 1;
      } catch (err) {
        // Per docs/PHASE-0-PLAN.md's established pattern (mirrored here for branches, per
        // the Phase 1.2 instruction): one malformed spot must not abort the whole sync — it
        // is skipped and reported loudly instead.
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.error(`Skipping spot ${spot.spot_id}: ${reason}`);
        branchesSkipped.push({ posterSpotId: String(spot.spot_id), reason });
      }
    }

    if (spots.length > 0) {
      const validSpotIds = spots
        .map((s) => this.tryExtractPosterSpotId(s))
        .filter((id): id is number => id !== null);
      await this.branchRepository.deactivateBranchesNotIn(validSpotIds);
    } else {
      // An empty list from Poster is indistinguishable from "account genuinely has zero
      // spots" and "something went wrong upstream" — treated as suspicious, never as
      // authorization to deactivate every existing branch. Same rule as CatalogService.
      this.logger.warn('Poster returned an empty spot list — skipping branch deactivation as a precaution.');
    }

    return { branchesSynced, branchesSkipped };
  }

  listActive() {
    return this.branchRepository.findAllActive();
  }

  // spot_id is a numeric string per the verified live shape (see poster.types.ts) — this
  // makes that conversion explicit and rejects anything that doesn't cleanly parse as an
  // integer, rather than silently coercing a malformed value (e.g. NaN) into the DB.
  private extractPosterSpotId(spot: PosterSpot): number {
    const id = this.tryExtractPosterSpotId(spot);
    if (id === null) {
      throw new Error(`Spot has an invalid/non-integer spot_id (raw: ${JSON.stringify(spot.spot_id)})`);
    }
    return id;
  }

  private tryExtractPosterSpotId(spot: PosterSpot): number | null {
    const id = Number(spot.spot_id);
    return Number.isInteger(id) ? id : null;
  }

  private validateSpotName(spot: PosterSpot): void {
    if (typeof spot.spot_name !== 'string' || spot.spot_name.length === 0) {
      throw new Error(`Spot ${spot.spot_id} has an unexpected/missing spot_name (raw: ${JSON.stringify(spot.spot_name)})`);
    }
  }
}
