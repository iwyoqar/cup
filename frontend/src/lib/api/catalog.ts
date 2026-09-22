import { apiRequest } from './client';
import { Category, Product } from '../../types/api';

// No categoryId query param on GET /catalog/products yet (see catalog.controller.ts) — the
// full active product list is small enough for a coffee shop menu that client-side filtering
// by category is simpler than adding a backend query param this phase doesn't otherwise need.
//
// Phase 9: both endpoints are public (no guard on CatalogController), so they are requested
// without the session token — see RequestOptions.skipAuth.
export function fetchCategories(): Promise<Category[]> {
  return apiRequest<Category[]>('/catalog/categories', { skipAuth: true });
}

export function fetchProducts(): Promise<Product[]> {
  return apiRequest<Product[]>('/catalog/products', { skipAuth: true });
}
