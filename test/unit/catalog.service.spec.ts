import { ConfigService } from '../../src/common/config/config.service';
import { CatalogRepository } from '../../src/modules/catalog/catalog.repository';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { PosterService } from '../../src/modules/poster/poster.service';

describe('CatalogService (PosterService and repository mocked)', () => {
  function buildService(posterOverrides: Partial<PosterService> = {}) {
    const poster = {
      getCategories: jest.fn().mockResolvedValue([{ category_id: '1', category_name: 'Coffee' }]),
      getProducts: jest.fn().mockResolvedValue([
        { product_id: '3', product_name: 'Cappuccino 250 ml', menu_category_id: '1', price: { '1': '300' } },
      ]),
      ...posterOverrides,
    } as unknown as PosterService;

    const repo = {
      upsertCategory: jest.fn().mockResolvedValue({ id: 'cat-1', posterCategoryId: '1' }),
      upsertProduct: jest.fn().mockResolvedValue({ id: 'prod-1' }),
      deactivateCategoriesNotIn: jest.fn().mockResolvedValue(undefined),
      deactivateProductsNotIn: jest.fn().mockResolvedValue(undefined),
      findCategoryByPosterId: jest.fn().mockResolvedValue({ id: 'cat-1', posterCategoryId: '1' }),
      findAllActiveCategories: jest.fn(),
      findAllActiveProducts: jest.fn(),
    } as unknown as CatalogRepository;

    const service = new CatalogService(poster, repo, new ConfigService());
    return { service, poster, repo };
  }

  it('upserts categories and products, then deactivates anything missing from Poster', async () => {
    const { service, repo } = buildService();

    const result = await service.sync();

    expect(repo.upsertCategory).toHaveBeenCalledWith(
      expect.objectContaining({ posterCategoryId: '1', name: 'Coffee' }),
    );
    expect(repo.upsertProduct).toHaveBeenCalledWith(
      expect.objectContaining({ posterProductId: '3', name: 'Cappuccino 250 ml', priceMinor: 300 }),
    );
    expect(repo.deactivateCategoriesNotIn).toHaveBeenCalledWith(['1']);
    expect(repo.deactivateProductsNotIn).toHaveBeenCalledWith(['3']);
    expect(result.productsSynced).toBe(1);
    expect(result.productsSkipped).toHaveLength(0);
  });

  it('skips (does not crash on) a product with a non-integer price, rather than truncating it silently', async () => {
    const { service } = buildService({
      getProducts: jest.fn().mockResolvedValue([
        { product_id: '9', product_name: 'Fractional Price Item', menu_category_id: '1', price: { '1': '300.50' } },
      ]),
    } as never);

    const result = await service.sync();

    expect(result.productsSynced).toBe(0);
    expect(result.productsSkipped).toEqual([
      expect.objectContaining({ posterProductId: '9', reason: expect.stringContaining('non-integer') }),
    ]);
  });

  it('skips (does not crash on) a product whose price is missing for the configured spot, and reports it', async () => {
    const { service } = buildService({
      getProducts: jest.fn().mockResolvedValue([
        { product_id: '9', product_name: 'Mystery Item', menu_category_id: '1', price: { '2': '500' } },
      ]),
    } as never);

    const result = await service.sync();

    expect(result.productsSynced).toBe(0);
    expect(result.productsSkipped).toEqual([
      expect.objectContaining({ posterProductId: '9' }),
    ]);
  });

  it('skips a product referencing an unknown category rather than crashing the whole sync', async () => {
    const { service, repo } = buildService();
    (repo.findCategoryByPosterId as jest.Mock).mockResolvedValueOnce(null);

    const result = await service.sync();

    expect(result.productsSkipped).toEqual([
      expect.objectContaining({ posterProductId: '3' }),
    ]);
  });

  it('skips (does not crash on) a malformed category, symmetric with how a malformed product is handled', async () => {
    const { service, repo } = buildService({
      getCategories: jest.fn().mockResolvedValue([
        { category_id: '1', category_name: 'Coffee' },
        { category_id: '2', category_name: '' }, // malformed: empty name
      ]),
    } as never);

    const result = await service.sync();

    expect(result.categoriesSynced).toBe(1);
    expect(result.categoriesSkipped).toEqual([expect.objectContaining({ posterCategoryId: '2' })]);
    // The whole sync must still proceed — products still get synced.
    expect(repo.upsertProduct).toHaveBeenCalled();
  });

  it('does NOT deactivate categories when Poster returns an empty category list (treated as suspicious, not authoritative)', async () => {
    const { service, repo } = buildService({
      getCategories: jest.fn().mockResolvedValue([]),
      getProducts: jest.fn().mockResolvedValue([]),
    } as never);

    const result = await service.sync();

    expect(repo.deactivateCategoriesNotIn).not.toHaveBeenCalled();
    expect(result.categoriesSynced).toBe(0);
  });

  it('does NOT deactivate products when Poster returns an empty product list (treated as suspicious, not authoritative)', async () => {
    const { service, repo } = buildService({
      getProducts: jest.fn().mockResolvedValue([]),
    } as never);

    const result = await service.sync();

    expect(repo.deactivateProductsNotIn).not.toHaveBeenCalled();
    // Categories are unaffected — a non-empty category list still deactivates normally.
    expect(repo.deactivateCategoriesNotIn).toHaveBeenCalledWith(['1']);
    expect(result.productsSynced).toBe(0);
  });
});
