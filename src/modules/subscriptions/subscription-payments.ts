import { Injectable } from '@nestjs/common';

// Coffee Subscription — the payment-provider SEAM. No provider is integrated in this phase (Click, Payme, Uzcard, Humo, Visa and
// Mastercard are all future work) and none is faked: the registry below is empty, so a purchase stays PAYMENT_PENDING until either a
// real provider confirms it or an admin uses the explicitly-flagged manual activation (which is NOT a payment).
//
// Integration points for a future provider (see docs/SUBSCRIPTIONS.md §Payments):
//   1. implement SubscriptionPaymentProvider and register it in SubscriptionPaymentRegistry;
//   2. POST /subscriptions/purchases (already exists) calls startPayment() for a PAYMENT_PENDING purchase and returns the provider's
//      redirect/deep link to the Mini App;
//   3. the provider's server callback — its own controller, authenticated with that provider's documented signature — calls
//      SubscriptionsService.confirmPaid(purchaseId, { source: 'PAYMENT', provider, providerPaymentId, amountMinor }), which is idempotent
//      (a repeated callback is a no-op) and verifies the amount against the purchase before activating anything.
// Never store a card number or any payment credential: only the provider's own payment id.

export interface StartPaymentInput {
  purchaseId: string;
  amountMinor: number;
  currency: string;
  description: string;
}

export interface StartPaymentResult {
  providerPaymentId: string;
  redirectUrl: string | null;
}

export interface SubscriptionPaymentProvider {
  readonly id: string; // e.g. 'click' | 'payme' — stored on SubscriptionPurchase.provider
  startPayment(input: StartPaymentInput): Promise<StartPaymentResult>;
}

// CASH is deliberately NOT a SubscriptionPaymentProvider and is never registered below: there is no startPayment (nothing to redirect to) and no
// webhook to verify — the cashier confirming cash was received IS the confirmation authority (see pos-widget-subscription.service.ts#purchaseCash,
// which calls SubscriptionsService.confirmPaid directly with source: 'PAYMENT'). It only reuses SubscriptionPurchase.provider as a plain tag so
// Admin/Finance can tell a cash sale apart from a future real provider, exactly like `docs/SUBSCRIPTIONS.md` documents for `provider`.
export const CASH_PROVIDER = 'CASH';

// Also not a SubscriptionPaymentProvider, for the same reason: CUP never calls a payment API for this path either. Poster itself takes the
// payment (by whatever method the register already supports — cash, card, Uzcard, ...); CUP only adds the priced line to the order and
// later confirms the order closed paid (poster-order-mutation.service.ts + pos-widget-subscription.service.ts#checkPosterOrderPayment).
export const POSTER_ORDER_PROVIDER = 'POSTER_ORDER';

@Injectable()
export class SubscriptionPaymentRegistry {
  private readonly providers: SubscriptionPaymentProvider[] = [];

  available(): { id: string }[] {
    return this.providers.map((p) => ({ id: p.id }));
  }

  get(id: string): SubscriptionPaymentProvider | null {
    return this.providers.find((p) => p.id === id) ?? null;
  }
}
