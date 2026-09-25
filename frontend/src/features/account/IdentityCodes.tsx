import { useEffect, useState } from 'react';
import { encodeCode128B, totalModules } from '../../lib/barcode/code128';

// Loaded lazily (see IdentitySection): the QR library is only needed on the Account screen.

// QR in a plain black-on-white SVG. Standard high-contrast, square modules, no styling that could hurt
// scanner reliability, and a 4-module quiet zone baked in. crispEdges keeps module edges sharp at any size.
export function QrCode({ value }: { value: string }) {
  const [matrix, setMatrix] = useState<boolean[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('qrcode-generator').then((module) => {
      if (cancelled) return;
      // Error correction M: robust against a smudged or glare-affected phone screen, still a small symbol
      // for a 12-character payload.
      const qr = module.default(0, 'M');
      qr.addData(value);
      qr.make();
      const size = qr.getModuleCount();
      setMatrix(Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col))));
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!matrix) {
    return <div className="block aspect-square h-auto w-[min(100%,320px)] rounded-sm animate-pulse-soft bg-skeleton" aria-hidden="true" />;
  }

  const quiet = 4;
  const size = matrix.length + quiet * 2;
  const path = matrix
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + quiet} ${y + quiet}h1v1h-1z` : '')))
    .join('');

  return (
    <svg
      className="block aspect-square h-auto w-[min(100%,320px)]"
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR kod: ${value}`}
    >
      <rect width={size} height={size} className="fill-white" />
      <path d={path} className="fill-black" />
    </svg>
  );
}

// Code 128 linear barcode (secondary — for scanners that read linear codes better than QR).
export function Code128Barcode({ value }: { value: string }) {
  const runs = encodeCode128B(value);
  const quiet = 10; // Code 128 asks for a 10-module quiet zone on each side
  const width = totalModules(runs) + quiet * 2;
  const bars: string[] = [];
  let x = quiet;
  runs.forEach((run, index) => {
    if (index % 2 === 0) bars.push(`M${x} 0h${run}v1h-${run}z`);
    x += run;
  });

  return (
    <svg
      className="block h-14 w-[min(100%,320px)]"
      viewBox={`0 0 ${width} 1`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Shtrix-kod: ${value}`}
    >
      <rect width={width} height={1} className="fill-white" />
      <path d={bars.join('')} className="fill-black" />
    </svg>
  );
}
