import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import Portal from './Portal';

const ToastCtx = createContext(null);

const ICONS = { success: CheckCircle2, warning: AlertTriangle, error: XCircle, info: Info };
const TONES = { success: 'text-success', warning: 'text-warning', error: 'text-danger', info: 'text-info' };

/** 全局 Toast（替代 window.alert）。useToast() 返回 { success, error, warning, info }。 */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const remove = useCallback((id) => setItems((l) => l.filter((x) => x.id !== id)), []);
  const push = useCallback((type, message, duration = 3500) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-4), { id, type, message }]);
    if (duration > 0) setTimeout(() => remove(id), duration);
  }, [remove]);

  const api = useMemo(() => ({
    success: (m, d) => push('success', m, d),
    error: (m, d) => push('error', m, d ?? 6000),
    warning: (m, d) => push('warning', m, d),
    info: (m, d) => push('info', m, d),
  }), [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <Portal>
        <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[min(92vw,360px)]" role="status" aria-live="polite">
          {items.map((t) => {
            const Icon = ICONS[t.type];
            return (
              <div key={t.id} className="card-pop fade-in flex items-start gap-2.5 px-3.5 py-3">
                <Icon size={18} className={`${TONES[t.type]} mt-0.5 shrink-0`} />
                <p className="text-sm text-fg flex-1 break-words">{t.message}</p>
                <button className="text-fg-subtle hover:text-fg" onClick={() => remove(t.id)} aria-label="关闭提示"><X size={14} /></button>
              </div>
            );
          })}
        </div>
      </Portal>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}
