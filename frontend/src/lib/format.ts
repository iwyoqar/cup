// CUP's canonical money unit is WHOLE UZS: every amount the API returns (the "...Minor" field
// names are historical) is an integer number of so'm — 300 means "300 so'm". Poster's own
// representation is translated once, at the Poster boundary (src/modules/poster/poster-money.ts),
// so this formatter must NEVER divide/multiply for Poster. Display only; never used for
// authoritative calculation.
export function formatSom(minor: number): string {
  return `${minor.toLocaleString('ru-RU')} so'm`;
}

// Dependency-free, locale-quirk-free date formatting (Phase 2 spec section 7: "Do not hardcode
// currency formatting in multiple components" applies just as much to dates — this is the one
// place order cards/detail screens get their date text from). Uzbek month abbreviations,
// transliterated plainly rather than relying on Intl's uneven 'uz' locale support.
const MONTH_ABBREVIATIONS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];

export function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  const day = date.getDate().toString().padStart(2, '0');
  const month = MONTH_ABBREVIATIONS[date.getMonth()];
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${day} ${month}, ${hours}:${minutes}`;
}
