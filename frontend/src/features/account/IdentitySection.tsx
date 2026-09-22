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
    <section className="account-section">
      <h2 className="section-title">Shaxsiy CUP</h2>
      <p className="hint-text">Baristaga ko'rsatib skaner qildiring.</p>

      {error ? (
        <p className="hint-text">Kodni yuklab bo'lmadi</p>
      ) : !identity ? (
        <SectionSkeleton height={320} />
      ) : (
        <div className="identity">
          <Suspense fallback={<div className="identity__qr identity__qr--loading skeleton-pulse" aria-hidden="true" />}>
            <QrCode value={identity.qrPayload} />
            <div className="identity__code">{identity.publicCode}</div>
            <Code128Barcode value={identity.publicCode} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
