// The only two icons the app needs; inline so there is no icon library and no extra request.
// Stroke/fill come from CSS (.icon-button svg / .product-visual svg), never from colours here.

export function IconUser() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c.9-3.7 3.9-5.6 7.5-5.6s6.6 1.9 7.5 5.6" />
    </svg>
  );
}

// Single line-drawn cup used as the product placeholder (the catalog API has no image field).
export function CupLine() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M13 26h32v9a16 16 0 0 1-16 16h0a16 16 0 0 1-16-16z" />
      <path d="M45 29h3.5a5.5 5.5 0 0 1 0 11H44" />
      <path d="M11 57h36" />
      <path d="M23 9c-2 3 2 5 0 8M31 9c-2 3 2 5 0 8M39 9c-2 3 2 5 0 8" />
    </svg>
  );
}
