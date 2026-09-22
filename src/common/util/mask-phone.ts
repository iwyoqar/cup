// Display-only masking for admin views that do not need the full number: keeps a leading "+" and the country-code-sized
// prefix plus the last four digits ("+998912090511" -> "+998•••••0511"). Anything too short to mask meaningfully keeps only
// its last two digits. Never used for lookups — masking is one-way.
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length < 8) return `${'•'.repeat(Math.max(digits.length - 2, 1))}${digits.slice(-2)}`;
  const plus = trimmed.startsWith('+') ? '+' : '';
  const prefix = digits.slice(0, 3);
  const last = digits.slice(-4);
  return `${plus}${prefix}${'•'.repeat(digits.length - prefix.length - last.length)}${last}`;
}
