import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Portal 弹层定位：基于触发器 rect，下方空间不足自动上翻；Esc / 点外部关闭；滚动/缩放时跟随。
 * 返回 { open, setOpen, triggerRef, popRef, style, placement }。
 */
export function usePopover({ minWidth = 0, estimatedHeight = 280, align = 'left' } = {}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState({});
  const [placement, setPlacement] = useState('bottom');
  const triggerRef = useRef(null);
  const popRef = useRef(null);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = popRef.current?.offsetHeight || estimatedHeight;
    const w = Math.max(r.width, minWidth);
    const below = window.innerHeight - r.bottom;
    const up = below < h + 12 && r.top > below;
    let left = align === 'right' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    setPlacement(up ? 'top' : 'bottom');
    setStyle({
      position: 'fixed', left, minWidth: w, zIndex: 80,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }, [align, estimatedHeight, minWidth]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (popRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus?.(); } };
    const onMove = () => place();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, place]);

  return { open, setOpen, triggerRef, popRef, style, placement };
}
