import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import Portal from './Portal';

/** 通用弹窗：实色卡片、Esc 关闭、点遮罩关闭、锁定背景滚动、移动端底部抽屉式。 */
export default function Modal({ open, title, onClose, children, footer, width = 'max-w-2xl', icon: Icon }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[70] bg-fg/50 flex items-end sm:items-center justify-center sm:p-4 fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
        <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`card-pop w-full ${width} max-h-[90vh] flex flex-col rounded-b-none sm:rounded-b-lg outline-none`}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-line shrink-0">
            <h3 className="text-sm font-semibold text-fg flex items-center gap-2 min-w-0">{Icon && <Icon size={16} className="text-primary shrink-0" />}<span className="truncate">{title}</span></h3>
            <button type="button" className="btn-ghost btn-icon !p-1.5" aria-label="关闭" onClick={onClose}><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto scroll-thin p-5">{children}</div>
          {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2 shrink-0">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}
