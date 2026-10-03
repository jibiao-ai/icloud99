import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

/** 防抖 300ms 的搜索框。 */
export default function SearchInput({ value = '', onChange, placeholder = '搜索', width = 220, 'aria-label': ariaLabel }) {
  const [text, setText] = useState(value);
  const timer = useRef(null);
  useEffect(() => { setText(value); }, [value]);
  const push = (v) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange?.(v), 300);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="relative" style={{ width }}>
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
      <input className="field pl-8 pr-7 !py-1.5" value={text} placeholder={placeholder} aria-label={ariaLabel || placeholder} onChange={(e) => push(e.target.value)} />
      {text && (
        <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg" aria-label="清空搜索" onClick={() => { push(''); clearTimeout(timer.current); onChange?.(''); }}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
