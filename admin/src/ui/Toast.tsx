import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { cx } from './cx';

export type ToastTone = 'success' | 'warning' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  text?: string;
}

const ToastContext = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => undefined);

const TONE: Record<ToastTone, string> = {
  success: 'border-l-ok',
  warning: 'border-l-terracotta',
  error: 'border-l-err',
  info: 'border-l-black',
};

// The Admin's one toast system (there was none before Design System 2.0). Toasts stack bottom-right, are announced to
// screen readers (role=status / alert for errors), and dismiss after 5 s or on click.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = nextId.current++;
    setItems((cur) => [...cur.slice(-3), { ...t, id }]);
  }, []);
  const dismiss = (id: number) => setItems((cur) => cur.filter((t) => t.id !== id));
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => (
          <Toast key={t.id} onDismiss={() => dismiss(t.id)} toast={t} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const t = setTimeout(() => dismissRef.current(), 5000);
    return () => clearTimeout(t);
  }, []);
  return (
    <button className={cx('pointer-events-auto animate-toast-in rounded-md border border-l-[3px] border-line bg-white px-4 py-3 text-left shadow-menu', TONE[toast.tone])} onClick={onDismiss} role={toast.tone === 'error' ? 'alert' : 'status'} type="button">
      <div className="text-sm font-semibold text-black">{toast.title}</div>
      {toast.text && <div className="mt-0.5 text-[13px] text-muted">{toast.text}</div>}
    </button>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
