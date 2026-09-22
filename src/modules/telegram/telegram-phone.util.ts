// Telegram's contact.phone_number is typically digits only, no leading "+" (e.g.
// "998912090511"). The one established convention in this codebase (the real phone used in
// the Phase 0 smoke test) is "+998912090511" — leading "+", digits only otherwise. This is
// intentionally minimal normalization, not a full phone-parsing library (e.g. libphonenumber)
// — that would be overbuilding for what this phase needs: strip incidental formatting
// characters a client might include, then ensure a leading "+".
export function normalizeTelegramPhone(rawPhoneNumber: string): string {
  const digitsAndPlus = rawPhoneNumber.replace(/[^\d+]/g, '');
  return digitsAndPlus.startsWith('+') ? digitsAndPlus : `+${digitsAndPlus}`;
}
