import { ReactNode } from 'react';

// Line icons in the Mini App's own style (frontend/src/app/icons.tsx): inline SVG, no icon library, no extra request. Stroke/fill are set on the <svg> (Design System 2.0).
const PATHS = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5" />
      <rect x="13.5" y="11" width="7" height="9.5" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  sales: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.6 9.3C14.1 8.5 13.2 8 12 8c-1.5 0-2.6.8-2.6 2s1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.2 0-2.1-.5-2.6-1.3M12 6.5V8M12 16v1.5" />
    </>
  ),
  customers: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19c.6-3.3 2.9-5 5.5-5s4.9 1.7 5.5 5" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M16 14.3c2.6-.3 4.5 1.3 5 4.2" />
    </>
  ),
  segments: <path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" />,
  finance: (
    <>
      <rect x="3.5" y="6.5" width="17" height="12" rx="1.8" />
      <path d="M3.5 10h17" />
      <circle cx="16.5" cy="14.2" r="1.6" />
    </>
  ),
  loyalty: <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />,
  rewards: (
    <>
      <rect x="4" y="9" width="16" height="11" rx="1.5" />
      <path d="M3 9h18v3H3zM12 9v11" />
      <path d="M12 9C10.5 5.5 7 6 7 8s3 1.6 5 1zM12 9c1.5-3.5 5-3 5-1s-3 1.6-5 1z" />
    </>
  ),
  promotions: (
    <>
      <path d="M3.5 12.5V4.5h8l9 9-8 8z" />
      <circle cx="8" cy="9" r="1.3" />
    </>
  ),
  referrals: (
    <>
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="6" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6" />
    </>
  ),
  campaigns: (
    <>
      <path d="M21 4L3 11l6.5 2.5L12 20z" />
      <path d="M9.5 13.5L21 4" />
    </>
  ),
  automation: <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" />,
  import: (
    <>
      <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  sync: (
    <>
      <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  staff: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="11" r="2.2" />
      <path d="M5.8 16c.5-1.7 1.8-2.5 3.2-2.5s2.7.8 3.2 2.5M14.5 10h4M14.5 13.5h3" />
    </>
  ),
  analytics: (
    <>
      <path d="M5 20v-8M12 20V5M19 20v-5" />
      <path d="M3 20.5h18" />
    </>
  ),
  growth: (
    <>
      <path d="M3.5 17l5.5-5.5 3.5 3.5L20.5 7" />
      <path d="M15 7h5.5v5.5" />
    </>
  ),
  branch: (
    <>
      <path d="M4 9l1.5-5h13L20 9" />
      <path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9" />
      <path d="M5.5 12v8h13v-8" />
    </>
  ),
  health: <path d="M3 12h4l2-6 4 12 2-6h6" />,
  errors: (
    <>
      <path d="M12 4L2.8 19.5h18.4z" />
      <path d="M12 10v4.5M12 17.3v.2" />
    </>
  ),
  audit: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 13.5h7M8.5 17h4" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  logout: (
    <>
      <path d="M9 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h3" />
      <path d="M15 8l4 4-4 4M19 12H9" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

// Stroke styling lives on the SVG itself (Design System 2.0), so an icon renders correctly anywhere; size via className.
export function Icon({ name, className = 'size-[18px]' }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden="true" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} viewBox="0 0 24 24">
      {PATHS[name]}
    </svg>
  );
}
