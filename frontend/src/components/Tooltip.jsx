import { useRef, useState } from 'react';
import Portal from './Portal';

/** 轻量悬浮提示：实色卡片，Portal 渲染，避免被裁剪。 */
export default function Tooltip({ content, children }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.top });
  };
  return (
    <>
      <span ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)} className="inline-flex flex-1 min-w-0">
        {children}
      </span>
      {pos && content && (
        <Portal>
          <div className="card-pop fixed z-[90] px-2.5 py-1.5 text-xs text-fg pointer-events-none whitespace-nowrap" style={{ left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)' }} role="tooltip">
            {content}
          </div>
        </Portal>
      )}
    </>
  );
}
