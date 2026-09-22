import { FormEvent, useEffect, useState } from 'react';
import { CameraScanner } from '../components/CameraScanner';
import { goCustomers, openCustomer } from '../lib/route';

// Scan-first. Three ways in, all of which just OPEN the customer's profile (which does the lookup): camera (opened on demand), a hardware / keyboard-wedge
// scanner (characters typed fast + Enter, anywhere on the page), or typing the code by hand.
export function ScanPage() {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [manual, setManual] = useState('');

  // Keyboard-wedge scanners "type" the code very quickly and finish with Enter. When focus is not in a text field, collect fast keystrokes and open the
  // profile on Enter (the visible field handles its own Enter).
  useEffect(() => {
    let buffer = '';
    let lastKeyAt = 0;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const now = Date.now();
      if (now - lastKeyAt > 120) buffer = '';
      lastKeyAt = now;
      if (event.key === 'Enter') {
        if (buffer.length >= 6) openCustomer(buffer);
        buffer = '';
      } else if (event.key.length === 1) {
        buffer += event.key;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    if (manual.trim()) openCustomer(manual.trim());
  };

  return (
    <div className="scan">
      <h1 className="scan__title">Mijozni skanerlash</h1>

      {cameraOpen ? (
        <CameraScanner onClose={() => setCameraOpen(false)} onCode={(code) => openCustomer(code.trim())} />
      ) : (
        <button className="button button--primary button--xl" onClick={() => setCameraOpen(true)} type="button">
          Kamera bilan skanerlash
        </button>
      )}

      <form className="manual" onSubmit={submitManual}>
        <label className="field">
          <span>QR topilmadimi? CUP kodini kiriting</span>
          <input autoCapitalize="characters" autoComplete="off" autoCorrect="off" maxLength={64} onChange={(e) => setManual(e.target.value)} placeholder="CUP-XXXXXXXX" value={manual} />
        </label>
        <button className="button button--secondary" disabled={!manual.trim()} type="submit">
          Ochish
        </button>
      </form>

      <button className="link-button link-button--block" onClick={goCustomers} type="button">
        Ism yoki telefon bo‘yicha qidirish →
      </button>
    </div>
  );
}
