// Camera scanning. Nothing here runs until the barista explicitly taps "scan" — camera permission is never
// requested at login or page load. Uses the browser's native BarcodeDetector when available (fast, no
// extra code) and falls back to jsQR (lazy-loaded) for browsers without it, e.g. iOS Safari.

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (options?: { formats: string[] }) => BarcodeDetectorLike;

export class CameraUnavailableError extends Error {}

export interface ScanSession {
  stop: () => void;
}

const SCAN_INTERVAL_MS = 150;

export async function startCameraScan(video: HTMLVideoElement, onCode: (text: string) => void): Promise<ScanSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraUnavailableError('Kamera mavjud emas');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch {
    throw new CameraUnavailableError('Kameraga ruxsat berilmadi');
  }

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play().catch(() => undefined);

  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  const detector = Detector ? new Detector({ formats: ['qr_code', 'code_128'] }) : null;
  const jsQR = detector ? null : (await import('jsqr')).default;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let busy = false;

  const tick = async () => {
    if (stopped) return;
    if (!busy && video.readyState >= 2 && video.videoWidth > 0) {
      busy = true;
      try {
        let text: string | null = null;
        if (detector) {
          const found = await detector.detect(video);
          text = found[0]?.rawValue ?? null;
        } else if (jsQR && context) {
          const scale = Math.min(1, 640 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          text = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
        }
        if (text && !stopped) {
          stop();
          onCode(text);
          return;
        }
      } catch {
        // A single failed frame is not fatal — keep scanning.
      }
      busy = false;
    }
    if (!stopped) setTimeout(tick, SCAN_INTERVAL_MS);
  };

  function stop() {
    stopped = true;
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }

  setTimeout(tick, SCAN_INTERVAL_MS);
  return { stop };
}
