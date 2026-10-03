import { useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import Portal from './Portal';
import { usePopover } from './usePopover';

/**
 * 自绘下拉（替代原生 select）。
 * options[{value,label,hint,group,disabled}] / value / onChange / multiple / searchable / clearable
 * size('sm'|'md') / placeholder / aria-label / minWidth / invalid
 * 触发器 role="combobox"，选项 role="option"。
 */
export default function CustomSelect({
  options = [], value, onChange, multiple = false, searchable = false, clearable = false,
  size = 'md', placeholder = '请选择', minWidth = 140, 'aria-label': ariaLabel, invalid, disabled, width,
}) {
  const { open, setOpen, triggerRef, popRef, style } = usePopover({ minWidth, estimatedHeight: 300 });
  const [kw, setKw] = useState('');
  const [active, setActive] = useState(-1);

  const selected = multiple ? (Array.isArray(value) ? value : []) : value;
  const isSel = (v) => (multiple ? selected.includes(v) : selected === v);

  const shown = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return k ? options.filter((o) => `${o.label} ${o.hint || ''}`.toLowerCase().includes(k)) : options;
  }, [options, kw]);

  const label = useMemo(() => {
    if (multiple) {
      if (!selected.length) return null;
      const names = options.filter((o) => selected.includes(o.value)).map((o) => o.label);
      return names.length > 2 ? `已选 ${names.length} 项` : names.join('、');
    }
    return options.find((o) => o.value === selected)?.label ?? null;
  }, [multiple, selected, options]);

  const pick = (o) => {
    if (o.disabled) return;
    if (multiple) {
      onChange(isSel(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value]);
    } else {
      onChange(o.value);
      setOpen(false);
    }
  };

  const onKey = (e) => {
    if (disabled) return;
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(shown[active]); }
  };

  const grouped = useMemo(() => {
    const out = []; let last;
    shown.forEach((o, i) => { if (o.group && o.group !== last) { out.push({ header: o.group }); last = o.group; } out.push({ o, i }); });
    return out;
  }, [shown]);

  const pad = size === 'sm' ? 'py-1.5 text-xs' : 'py-2 text-sm';
  const hasValue = multiple ? selected.length > 0 : selected !== undefined && selected !== null && selected !== '';

  return (
    <>
      <button
        ref={triggerRef} type="button" role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-label={ariaLabel} disabled={disabled}
        onClick={() => { setOpen(!open); setKw(''); setActive(-1); }} onKeyDown={onKey}
        className={`field flex items-center justify-between gap-2 text-left px-3 ${pad} ${invalid ? 'field-error' : ''}`}
        style={{ width: width || 'auto', minWidth }}
      >
        <span className={`truncate ${label === null ? 'text-fg-subtle' : ''}`}>{label ?? placeholder}</span>
        <span className="flex items-center gap-1 shrink-0">
          {clearable && hasValue && !disabled && (
            <span role="button" aria-label="清除选择" className="text-fg-subtle hover:text-fg" onClick={(e) => { e.stopPropagation(); onChange(multiple ? [] : ''); }}><X size={13} /></span>
          )}
          <ChevronDown size={14} className={`text-fg-subtle transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && (
        <Portal>
          <div ref={popRef} style={style} className="card-pop overflow-hidden fade-in" onKeyDown={onKey}>
            {searchable && (
              <div className="p-2 border-b border-line">
                <input autoFocus className="field !py-1.5 text-xs" placeholder="搜索" aria-label="搜索选项" value={kw} onChange={(e) => { setKw(e.target.value); setActive(0); }} />
              </div>
            )}
            <ul role="listbox" aria-multiselectable={multiple} className="max-h-60 overflow-y-auto scroll-thin py-1">
              {grouped.length === 0 && <li className="px-3 py-3 text-xs text-fg-subtle text-center">无匹配项</li>}
              {grouped.map((g, k) => g.header ? (
                <li key={`h${k}`} className="px-3 pt-2 pb-1 text-[11px] font-semibold text-fg-subtle" role="presentation">{g.header}</li>
              ) : (
                <li
                  key={String(g.o.value)} role="option" aria-selected={isSel(g.o.value)} aria-disabled={g.o.disabled}
                  onClick={() => pick(g.o)} onMouseEnter={() => setActive(g.i)}
                  className={`flex items-center justify-between gap-3 px-3 py-2 text-sm cursor-pointer ${g.o.disabled ? 'opacity-40 cursor-not-allowed' : ''} ${active === g.i ? 'bg-hover' : ''} ${isSel(g.o.value) ? 'text-primary font-medium' : 'text-fg'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{g.o.label}</span>
                    {g.o.hint && <span className="block text-[11px] text-fg-subtle truncate">{g.o.hint}</span>}
                  </span>
                  {isSel(g.o.value) && <Check size={14} className="shrink-0" />}
                </li>
              ))}
            </ul>
          </div>
        </Portal>
      )}
    </>
  );
}
