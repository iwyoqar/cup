import { LoyaltyTransactionType } from '../types/api';

// Centralized, same philosophy as orderStatusLabels.ts: one place mapping the backend's
// existing transaction types to Uzbek customer-facing labels — never invents new business
// semantics beyond what LOYALTY_TRANSACTION_TYPES already declares
// (src/common/enums/loyalty-transaction-type.ts). Only WELCOME_BONUS is reachable by any
// current backend code path; the rest are declared for the ledger's own future extensibility.
const LOYALTY_TRANSACTION_LABELS: Record<LoyaltyTransactionType, string> = {
  WELCOME_BONUS: 'Xush kelibsiz bonusi',
  EARN: 'Xariddan ball',
  SPEND: 'Ballardan foydalanildi',
  ADJUSTMENT: "Ballar o'zgarishi",
  EXPIRATION: "Ballarning amal qilish muddati tugadi",
};

// Unknown/unrecognized type: never crashes, falls back to the same neutral label as
// ADJUSTMENT — a generic "something changed your points" rather than an invented meaning.
export function getLoyaltyTransactionLabel(type: string): string {
  return LOYALTY_TRANSACTION_LABELS[type as LoyaltyTransactionType] ?? "Ballar o'zgarishi";
}
