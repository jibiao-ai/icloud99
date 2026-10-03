import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import Portal from './Portal';
import { usePopover } from './usePopover';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const p2 = (n) => String(n).padStart(2, '0');
const fmt = (y, m, d) => `${y}-${p2(m + 1)}-${p2(d)}`;

function parse(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(v || '');
  if (!m) return null;
  return { y: +m[1], m: +m[2] - 1, d: +m[3], hh: m[4] ? +m[4] : 0, mm: m[5] ? +m[5] : 0 };
}

/**
 * 自绘日历（替代原生 date/datetime-local）。
 * value('YYYY-MM-DD' | withTime 时 'YYYY-MM-DDTHH:mm') / onChange / min / max / withTime / clearable / size / width / aria-label
 */
export default function DatePicker({ value, onChange, min, max, withTime = false, clearable = false, size = 'md', width = 150, 'aria-label': ariaLabel, invalid, disabled }) {
  const { open, setOpen, triggerRef, popRef, style } = usePopover({ minWidth: 264, estimatedHeight: withTime ? 380 : 330 });
  const cur = parse(value);
  const now = new Date();
  const [view, setView] = useState(() => ({ y: cur?.y ?? now.getFullYear(), m: cur?.m ?? now.getMonth() }));
  const [time, setTime] = useState({ hh: cur?.hh ?? 0, mm: cur?.mm ?? 0 });

  const today = fmt(now.getFullYear(), now.getMonth(), now.getDate());
  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay();
    const days = new Date(view.y, view.m + 1, 0).getDate();
    const out = [];
    for (let i = 0; i < first; i++) out.push(null);
    for (let d = 1; d <= days; d++) out.push(d);
    return out;
  }, [view]);

  const nav = (dy, dm) => setView((v) => { const t = new Date(v.y + dy, v.m + dm, 1); return { y: t.getFullYear(), m: t.getMonth() }; });
  const out = (s) => (min && s < min) || (max && s > max);
  const emit = (dateStr, t = time) => onChange?.(withTime ? `${dateStr}T${p2(t.hh)}:${p2(t.mm)}` : dateStr);

  const choose = (d) => {
    const s = fmt(view.y, view.m, d);
    if (out(s)) return;
    emit(s);
    if (!withTime) setOpen(false);
  };
  const setT = (k, v) => {
    const t = { ...time, [k]: Math.max(0, Math.min(k === 'hh' ? 23 : 59, Number(v) || 0)) };
    setTime(t);
    if (cur) emit(fmt(cur.y, cur.m, cur.d), t);
  };
  const jumpToday = () => {
    setView({ y: now.getFullYear(), m: now.getMonth() });
    if (!out(today)) { emit(today); if (!withTime) setOpen(false); }
  };

  const display = cur ? (withTime ? `${fmt(cur.y, cur.m, cur.d)} ${p2(cur.hh)}:${p2(cur.mm)}` : fmt(cur.y, cur.m, cur.d)) : '';
  const pad = size === 'sm' ? 'py-1.5 text-xs' : 'py-2 text-sm';

  return (
    <>
      <button
        ref={triggerRef} type="button" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
        onClick={() => { if (cur) setView({ y: cur.y, m: cur.m }); setOpen(!open); }}
        className={`field flex items-center justify-between gap-2 text-left px-3 ${pad} ${invalid ? 'field-error' : ''}`} style={{ width: withTime ? Math.max(width, 190) : width }}
      >
        <span className={display ? '' : 'text-fg-subtle'}>{display || '选择日期'}</span>
        <span className="flex items-center gap-1 shrink-0">
          {clearable && display && !disabled && <span role="button" aria-label="清除日期" className="text-fg-subtle hover:text-fg" onClick={(e) => { e.stopPropagation(); onChange?.(''); }}><X size={13} /></span>}
          <CalendarDays size={14} className="text-fg-subtle" />
        </span>
      </button>
      {open && (
        <Portal>
          <div ref={popRef} style={style} role="dialog" aria-label="日期选择" className="card-pop p-3 w-[264px] fade-in">
            <div className="flex items-center justify-between mb-2">
              <div className="flex">
                <button type="button" className="btn-ghost btn-icon !p-1" aria-label="上一年" onClick={() => nav(-1, 0)}><ChevronsLeft size={15} /></button>
                <button type="button" className="btn-ghost btn-icon !p-1" aria-label="上一月" onClick={() => nav(0, -1)}><ChevronLeft size={15} /></button>
              </div>
              <span className="text-sm font-semibold text-fg">{view.y} 年 {view.m + 1} 月</span>
              <div className="flex">
                <button type="button" className="btn-ghost btn-icon !p-1" aria-label="下一月" onClick={() => nav(0, 1)}><ChevronRight size={15} /></button>
                <button type="button" className="btn-ghost btn-icon !p-1" aria-label="下一年" onClick={() => nav(1, 0)}><ChevronsRight size={15} /></button>
              </div>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] text-fg-subtle mb-1">{WEEK.map((w) => <span key={w} className="py-1">{w}</span>)}</div>
            <div className="grid grid-cols-7 gap-y-0.5" role="grid">
              {cells.map((d, i) => {
                if (d === null) return <span key={`e${i}`} />;
                const s = fmt(view.y, view.m, d);
                const sel = cur && fmt(cur.y, cur.m, cur.d) === s;
                const dis = out(s);
                return (
                  <button
                    key={s} type="button" disabled={dis} aria-label={s} aria-pressed={!!sel} onClick={() => choose(d)}
                    className={`h-8 text-xs rounded-md transition-colors ${sel ? 'bg-primary text-primary-text font-semibold' : dis ? 'text-fg-subtle opacity-40 cursor-not-allowed' : s === today ? 'border border-primary text-primary hover:bg-hover' : 'text-fg hover:bg-hover'}`}
                  >{d}</button>
                );
              })}
            </div>
            {withTime && (
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line">
                <span className="text-xs text-fg-muted">时间</span>
                <input className="field !w-14 !py-1 text-center" inputMode="numeric" aria-label="小时" value={p2(time.hh)} onChange={(e) => setT('hh', e.target.value)} />
                <span>:</span>
                <input className="field !w-14 !py-1 text-center" inputMode="numeric" aria-label="分钟" value={p2(time.mm)} onChange={(e) => setT('mm', e.target.value)} />
              </div>
            )}
            <div className="flex justify-between mt-3 pt-2 border-t border-line">
              <button type="button" className="btn-ghost btn-sm" onClick={jumpToday} disabled={out(today)}>今天</button>
              {withTime && <button type="button" className="btn-primary btn-sm" onClick={() => setOpen(false)}>确定</button>}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
