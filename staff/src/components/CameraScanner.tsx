import { useEffect, useRef, useState } from 'react';
import { CameraUnavailableError, ScanSession, startCameraScan } from '../lib/scanner';
import { Button } from './ui';

interface CameraScannerProps {
  onCode: (text: string) => void;
  onClose: () => void;
}

// Opened only when the barista taps "scan" — the camera permission prompt appears then, never earlier.
export function CameraScanner({ onCode, onClose }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let session: ScanSession | null = null;
    let cancelled = false;
    if (videoRef.current) {
      startCameraScan(videoRef.current, (text) => {
        if (!cancelled) onCode(text);
      })
        .then((started) => {
          if (cancelled) started.stop();
          else session = started;
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof CameraUnavailableError ? err.message : 'Kamerani ochib bo‘lmadi');
        });
    }
    return () => {
      cancelled = true;
      session?.stop();
    };
    // onCode is intentionally read once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex flex-col gap-3 overflow-hidden rounded-md bg-black pb-3">
      <video ref={videoRef} className="aspect-square w-full bg-black object-cover" muted />
      <div className="pointer-events-none absolute inset-x-[14%] top-[14%] aspect-square rounded-md border-[3px] border-terracotta" aria-hidden="true" />
      {error && <p className="px-4 text-center text-cream">{error}. Kodni qo‘lda kiriting.</p>}
      <Button onClick={onClose} className="self-center bg-white" variant="secondary">
        Yopish
      </Button>
    </div>
  );
}
