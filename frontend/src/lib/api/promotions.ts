import { apiRequest } from './client';
import { CustomerPromotion } from '../../types/api';

export function fetchMyPromotions(): Promise<CustomerPromotion[]> {
  return apiRequest<CustomerPromotion[]>('/promotions');
}
