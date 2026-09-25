import { lazy, Suspense, useEffect, useState } from 'react';
import { CustomerIdentity } from '../../types/api';
import { fetchMyIdentity } from '../../lib/api/customers';
import { toUserMessage } from '../../lib/api/errors';
import { SectionSkeleton } from '../../app/SectionSkeleton';

// The QR + barcode drawing code (and the QR library behind it) is split out of the main bundle.
const QrCode = lazy(() => import('./IdentityCodes').then((m) => ({ default: m.QrCode })));
const Code128Barcode = lazy(() => import('./IdentityCodes').then((m) => ({ default: m.Code128Barcode })));

// "Shaxsiy CUP" — the customer's identity for the barista. Showing it (or the barista scanning it) NEVER
// changes any loyalty/reward/purchase state; it only lets staff look the customer up.
export function IdentitySection() {
  const [identity, setIdentity] = useState<CustomerIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyIdentity()
      .then((fetched) => {
        if (!cancelled) setIdentity(fetched);
      })
      .catch((err) => {
        if (!cancelled) setError(toUserMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-section leading-[1.2] font-medium">Shaxsiy CUP</h2>
      <p className="text-small leading-[1.45] text-muted">Baristaga ko'rsatib skaner qildiring.</p>

      {error ? (
        <p className="text-small leading-[1.45] text-muted">Kodni yuklab bo'lmadi</p>
      ) : !identity ? (
        <SectionSkeleton height={320} />
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-md border border-line bg-white px-3 py-6">
          <Suspense fallback={<div className="block aspect-square h-auto w-[min(100%,320px)] rounded-sm animate-pulse-soft bg-skeleton" aria-hidden="true" />}>
            <QrCode value={identity.qrPayload} />
            <div className="text-center font-sans text-lead font-bold tracking-[0.14em] tabular-nums">{identity.publicCode}</div>
            <Code128Barcode value={identity.publicCode} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
