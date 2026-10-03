import { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import CustomSelect from './CustomSelect';

const SIZES = [10, 20, 50].map((n) => ({ value: n, label: `${n} 条/页` }));

/** 分页：首页/上一页/页码/下一页/末页 + 跳转 + 每页条数（默认 10，可选 10/20/50）。 */
export default function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, sizes = true }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const [jump, setJump] = useState('');
  const go = (p) => onPageChange(Math.min(pages, Math.max(1, p)));
  const list = [];
  const lo = Math.max(2, page - 2), hi = Math.min(pages - 1, page + 2);
  list.push(1);
  if (lo > 2) list.push('…l');
  for (let i = lo; i <= hi; i++) list.push(i);
  if (hi < pages - 1) list.push('…r');
  if (pages > 1) list.push(pages);
  const b = (on) => `min-w-8 h-8 px-2 rounded-md text-xs transition-colors ${on ? 'bg-primary text-primary-text font-semibold' : 'text-fg-muted hover:bg-hover'}`;
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-line" aria-label="分页">
      <span className="text-xs text-fg-subtle">共 {total} 条 · {page}/{pages} 页</span>
      <div className="flex items-center gap-1 flex-wrap">
        <button className="btn-ghost btn-icon !p-1.5" aria-label="首页" disabled={page <= 1} onClick={() => go(1)}><ChevronsLeft size={15} /></button>
        <button className="btn-ghost btn-icon !p-1.5" aria-label="上一页" disabled={page <= 1} onClick={() => go(page - 1)}><ChevronLeft size={15} /></button>
        {list.map((p) => (typeof p === 'string'
          ? <span key={p} className="px-1 text-fg-subtle">…</span>
          : <button key={p} className={b(p === page)} aria-current={p === page ? 'page' : undefined} onClick={() => go(p)}>{p}</button>))}
        <button className="btn-ghost btn-icon !p-1.5" aria-label="下一页" disabled={page >= pages} onClick={() => go(page + 1)}><ChevronRight size={15} /></button>
        <button className="btn-ghost btn-icon !p-1.5" aria-label="末页" disabled={page >= pages} onClick={() => go(pages)}><ChevronsRight size={15} /></button>
        <span className="hidden sm:flex items-center gap-1.5 ml-2">
          <span className="text-xs text-fg-subtle">跳至</span>
          <input className="field !w-14 !py-1 text-center text-xs" inputMode="numeric" aria-label="跳转页码" value={jump} onChange={(e) => setJump(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter' && jump) { go(Number(jump)); setJump(''); } }} />
        </span>
        {sizes && onPageSizeChange && <span className="ml-2"><CustomSelect size="sm" options={SIZES} value={pageSize} onChange={onPageSizeChange} aria-label="每页条数" minWidth={104} /></span>}
      </div>
    </nav>
  );
}
