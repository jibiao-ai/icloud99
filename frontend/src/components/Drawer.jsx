import { useEffect } from 'react';
import { X } from 'lucide-react';
import Portal from './Portal';

/** 右侧抽屉。 */
export default function Drawer({ open, title, onClose, children, width = 'max-w-xl' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[70] bg-fg/50 fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
        <aside role="dialog" aria-modal="true" aria-label={title} className={`surface shadow-pop absolute right-0 top-0 bottom-0 w-full ${width} flex flex-col rounded-none`}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-line shrink-0">
            <h3 className="text-sm font-semibold text-fg truncate">{title}</h3>
            <button type="button" className="btn-ghost btn-icon !p-1.5" aria-label="关闭" onClick={onClose}><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto scroll-thin p-5">{children}</div>
        </aside>
      </div>
    </Portal>
  );
}
