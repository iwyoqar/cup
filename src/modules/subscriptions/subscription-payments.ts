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
