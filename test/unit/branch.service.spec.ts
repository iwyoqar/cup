import { BranchRepository } from '../../src/modules/branches/branch.repository';
import { BranchService } from '../../src/modules/branches/branch.service';
import { PosterService } from '../../src/modules/poster/poster.service';
import getSpotsFixture from '../fixtures/poster/get-spots.json';

describe('BranchService (PosterService and repository mocked)', () => {
  function buildService(posterOverrides: Partial<PosterService> = {}) {
    const poster = {
      getSpots: jest.fn().mockResolvedValue(getSpotsFixture.response),
      ...posterOverrides,
    } as unknown as PosterService;

    const repo = {
      upsertBranch: jest.fn().mockResolvedValue({ id: 'branch-1', posterSpotId: 1 }),
      deactivateBranchesNotIn: jest.fn().mockResolvedValue(undefined),
      findAllActive: jest.fn(),
    } as unknown as BranchRepository;

    const service = new BranchService(poster, repo);
    return { service, poster, repo };
  }

  it('maps the real captured spot shape correctly: numeric-string spot_id -> Int, empty address -> null', async () => {
    const { service, repo } = buildService();

    const result = await service.sync();

    expect(repo.upsertBranch).toHaveBeenCalledWith({
      posterSpotId: 1,
      name: 'iwyoqar',
      address: null,
    });
    expect(repo.deactivateBranchesNotIn).toHaveBeenCalledWith([1]);
    expect(result).toEqual({ branchesSynced: 1, branchesSkipped: [] });
  });

  it('maps a non-empty address through unchanged', async () => {
    const { service, repo } = buildService({
      getSpots: jest.fn().mockResolvedValue([{ spot_id: '2', spot_name: 'Chilonzor', spot_adress: 'Bunyodkor 1' }]),
    } as never);

    await service.sync();

    expect(repo.upsertBranch).toHaveBeenCalledWith({
      posterSpotId: 2,
      name: 'Chilonzor',
      address: 'Bunyodkor 1',
    });
  });

  it('skips (does not crash on) a spot with a non-integer spot_id, and reports it', async () => {
    const { service, repo } = buildService({
      getSpots: jest.fn().mockResolvedValue([{ spot_id: 'not-a-number', spot_name: 'Broken', spot_adress: '' }]),
    } as never);

    const result = await service.sync();

    expect(repo.upsertBranch).not.toHaveBeenCalled();
    expect(result.branchesSynced).toBe(0);
    expect(result.branchesSkipped).toEqual([
      expect.objectContaining({ posterSpotId: 'not-a-number' }),
    ]);
  });

  it('skips (does not crash on) a spot with a missing/empty spot_name, and reports it — the rest of the sync still proceeds', async () => {
    const { service, repo } = buildService({
      getSpots: jest.fn().mockResolvedValue([
        { spot_id: '1', spot_name: '', spot_adress: '' },
        { spot_id: '2', spot_name: 'Good Branch', spot_adress: '' },
      ]),
    } as never);

    const result = await service.sync();

    expect(result.branchesSynced).toBe(1);
    expect(result.branchesSkipped).toEqual([expect.objectContaining({ posterSpotId: '1' })]);
    expect(repo.upsertBranch).toHaveBeenCalledWith(
      expect.objectContaining({ posterSpotId: 2, name: 'Good Branch' }),
    );
  });

  it('does NOT deactivate any branch when Poster returns an empty spot list (treated as suspicious, not authoritative)', async () => {
    const { service, repo } = buildService({ getSpots: jest.fn().mockResolvedValue([]) } as never);

    const result = await service.sync();

    expect(repo.deactivateBranchesNotIn).not.toHaveBeenCalled();
    expect(result.branchesSynced).toBe(0);
  });

  it('does not deactivate a branch whose spot_id is valid but whose name failed validation (protects it, matching CatalogService philosophy)', async () => {
    const { service, repo } = buildService({
      getSpots: jest.fn().mockResolvedValue([{ spot_id: '1', spot_name: '', spot_adress: '' }]),
    } as never);

    await service.sync();

    expect(repo.deactivateBranchesNotIn).toHaveBeenCalledWith([1]);
  });

  it('listActive() delegates to the repository', async () => {
    const { service, repo } = buildService();
    (repo.findAllActive as jest.Mock).mockResolvedValue([{ id: 'branch-1' }]);

    const result = await service.listActive();

    expect(result).toEqual([{ id: 'branch-1' }]);
  });
});
