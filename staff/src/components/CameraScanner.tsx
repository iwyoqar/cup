import { useEffect, useRef, useState } from 'react';
import { CameraUnavailableError, ScanSession, startCameraScan } from '../lib/scanner';

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
    <div className="camera">
      <video ref={videoRef} className="camera__video" muted />
      <div className="camera__frame" aria-hidden="true" />
      {error && <p className="camera__error">{error}. Kodni qo‘lda kiriting.</p>}
      <button className="button button--secondary camera__close" onClick={onClose} type="button">
        Yopish
      </button>
    </div>
  );
}
