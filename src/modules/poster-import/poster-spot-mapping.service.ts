import { Injectable } from '@nestjs/common';
import { PosterService } from '../poster/poster.service';
import { PosterImportReportRepository } from './poster-import-report.repository';

export type SpotMappingStatus = 'MAPPED' | 'UNMAPPED_POSTER_SPOT' | 'DUPLICATE_MAPPING';

export interface SpotMappingReport {
  checkedAt: string;
  spots: {
    posterSpotId: number;
    posterName: string | null;
    status: SpotMappingStatus;
    branch: { id: string; name: string; isActive: boolean } | null;
    nameDiffers: boolean; // the CUP branch name is not Poster's current spot name (the id mapping is unaffected)
    importedTransactions: number;
  }[];
  // A CUP branch whose posterSpotId is not (or no longer) a Poster spot: kept as history, can never receive an import.
  unmappedBranches: { id: string; name: string; posterSpotId: number; isActive: boolean; orders: number; importedTransactions: number }[];
  counts: { posterSpots: number; mapped: number; unmappedPosterSpots: number; unmappedBranches: number; duplicateMappings: number; inactiveBranches: number; nameDifferences: number };
  // True when every Poster spot maps to exactly one ACTIVE branch and nothing is duplicated — the precondition the import gate checks per receipt.
  importReady: boolean;
  rules: string[];
}

// Phase 19 — READ-ONLY comparison of Poster's spots with CUP's branches. The mapping IS Branch.posterSpotId (required + unique; written only by the
// existing Poster spot sync), so there is nothing to re-point here: this report makes it visible before an import and names what would be skipped.
// It never infers a mapping from a name and never writes.
@Injectable()
export class PosterSpotMappingService {
  constructor(
    private readonly poster: PosterService,
    private readonly repository: PosterImportReportRepository,
  ) {}

  async report(): Promise<SpotMappingReport> {
    const [spots, branches, duplicates] = await Promise.all([this.poster.getSpots(), this.repository.branchesWithUsage(), this.repository.duplicateSpotIds()]);
    const duplicateSet = new Set(duplicates);
    const bySpot = new Map(branches.map((b) => [b.posterSpotId, b]));

    const rows = spots
      .map((s) => {
        const posterSpotId = Number(s.spot_id);
        if (!Number.isInteger(posterSpotId)) return null;
        const branch = bySpot.get(posterSpotId) ?? null;
        const status: SpotMappingStatus = duplicateSet.has(posterSpotId) ? 'DUPLICATE_MAPPING' : branch ? 'MAPPED' : 'UNMAPPED_POSTER_SPOT';
        return {
          posterSpotId,
          posterName: typeof s.spot_name === 'string' && s.spot_name !== '' ? s.spot_name : null,
          status,
          branch: branch ? { id: branch.id, name: branch.name, isActive: branch.isActive } : null,
          nameDiffers: !!branch && typeof s.spot_name === 'string' && s.spot_name !== '' && branch.name !== s.spot_name,
          importedTransactions: branch?._count.posterImportedTransactions ?? 0,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.posterSpotId - b.posterSpotId);

    const spotIds = new Set(rows.map((r) => r.posterSpotId));
    const unmappedBranches = branches
      .filter((b) => !spotIds.has(b.posterSpotId))
      .map((b) => ({ id: b.id, name: b.name, posterSpotId: b.posterSpotId, isActive: b.isActive, orders: b._count.orders, importedTransactions: b._count.posterImportedTransactions }));

    const counts = {
      posterSpots: rows.length,
      mapped: rows.filter((r) => r.status === 'MAPPED').length,
      unmappedPosterSpots: rows.filter((r) => r.status === 'UNMAPPED_POSTER_SPOT').length,
      unmappedBranches: unmappedBranches.length,
      duplicateMappings: duplicates.length,
      inactiveBranches: branches.filter((b) => !b.isActive).length,
      nameDifferences: rows.filter((r) => r.nameDiffers).length,
    };
    return {
      checkedAt: new Date().toISOString(),
      spots: rows,
      unmappedBranches,
      counts,
      importReady: rows.length > 0 && rows.every((r) => r.status === 'MAPPED' && r.branch?.isActive === true) && counts.duplicateMappings === 0,
      rules: [
        'A Poster spot maps to the CUP branch whose posterSpotId equals the spot id — never by name, staff, customer or the branch selected in Admin.',
        'The mapping is created by the Poster spot sync (a branch is created for every spot); it is not edited here. A branch name that differs from Poster only means the last sync is old.',
        'Receipts from an unmapped or inactive spot are never imported and never assigned to another branch.',
      ],
    };
  }
}
