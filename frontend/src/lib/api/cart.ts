import { apiRequest } from './client';
import { CartView } from '../../types/api';

export function fetchCart(): Promise<CartView> {
  return apiRequest<CartView>('/cart');
}

export function setCartBranch(branchId: string): Promise<CartView> {
  return apiRequest<CartView>('/cart/branch', { method: 'POST', body: { branchId } });
}

export function addCartItem(productId: string, quantity: number): Promise<CartView> {
  return apiRequest<CartView>('/cart/items', { method: 'POST', body: { productId, quantity } });
}

export function updateCartItemQuantity(cartItemId: string, quantity: number): Promise<CartView> {
  return apiRequest<CartView>(`/cart/items/${cartItemId}`, { method: 'PATCH', body: { quantity } });
}

export function removeCartItem(cartItemId: string): Promise<CartView> {
  return apiRequest<CartView>(`/cart/items/${cartItemId}`, { method: 'DELETE' });
}

export function clearCart(): Promise<CartView> {
  return apiRequest<CartView>('/cart', { method: 'DELETE' });
}

// Phase 8: selects/clears the free reward for the next checkout — never sends a discount
// amount or price, only WHICH program/product (server derives and re-validates everything
// else). See cart.service.ts's selectReward/clearReward.
export function selectCartReward(rewardProgramId: string, productId: string): Promise<CartView> {
  return apiRequest<CartView>('/cart/reward', { method: 'POST', body: { rewardProgramId, productId } });
}

export function clearCartReward(): Promise<CartView> {
  return apiRequest<CartView>('/cart/reward', { method: 'DELETE' });
}
