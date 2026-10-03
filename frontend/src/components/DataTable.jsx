import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import Checkbox from './Checkbox';
import Pagination from './Pagination';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';

/**
 * 服务端分页/排序受控表格。
 * columns[{key,title,width,align,sortable,sticky:'right',render}] / rows / rowKey / loading / refreshing / error / onRetry
 * page,pageSize,total,onPageChange,onPageSizeChange / sort,onSortChange / selectable,selected,onSelectedChange,selectionBar
 * toolbar / extra / empty{title,description} / settingsTab
 */
export default function DataTable({
  columns, rows, rowKey = 'id', loading, refreshing, error, onRetry, page, pageSize, total, onPageChange, onPageSizeChange,
  sort, onSortChange, selectable, selected = [], onSelectedChange, selectionBar, toolbar, extra, empty, settingsTab, onRowClick, rowClassName,
}) {
  const allKeys = rows.map((r) => r[rowKey]);
  const allOn = selectable && allKeys.length > 0 && allKeys.every((k) => selected.includes(k));
  const toggleAll = () => onSelectedChange?.(allOn ? selected.filter((k) => !allKeys.includes(k)) : [...new Set([...selected, ...allKeys])]);
  const toggle = (k) => onSelectedChange?.(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);

  const clickSort = (c) => {
    if (!c.sortable || !onSortChange) return;
    if (sort?.key !== c.key) onSortChange({ key: c.key, order: 'desc' });
    else if (sort.order === 'desc') onSortChange({ key: c.key, order: 'asc' });
    else onSortChange(null);
  };

  return (
    <section className="card overflow-hidden" aria-busy={loading || refreshing}>
      {(toolbar || extra) && <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-line">{toolbar}{extra}</div>}
      {selectable && selected.length > 0 && selectionBar && (
        <div className="flex items-center gap-3 px-4 py-2 bg-primary-soft text-xs text-fg">已选 {selected.length} 项 {selectionBar}</div>
      )}
      {error ? <ErrorState error={error} onRetry={onRetry} settingsTab={settingsTab} /> : (
        <div className="overflow-x-auto scroll-thin relative">
          {refreshing && <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary pulse-dot" />}
          <table className="w-full text-sm">
            <thead>
              <tr>
                {selectable && <th className="th w-10"><Checkbox checked={allOn} onChange={toggleAll} aria-label="全选" /></th>}
                {columns.map((c) => {
                  const on = sort?.key === c.key;
                  return (
                    <th key={c.key} className={`th ${c.sticky === 'right' ? 'sticky right-0 bg-muted' : ''}`} style={{ width: c.width, textAlign: c.align || 'left' }} aria-sort={on ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}>
                      {c.sortable ? (
                        <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => clickSort(c)}>
                          {c.title}{on ? (sort.order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="opacity-40" />}
                        </button>
                      ) : c.title}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: Math.min(pageSize || 5, 6) }).map((_, i) => (
                <tr key={`s${i}`} className="border-t border-line">
                  {selectable && <td className="td"><div className="skeleton h-4 w-4" /></td>}
                  {columns.map((c) => <td key={c.key} className="td"><div className="skeleton h-4 w-full max-w-[140px]" /></td>)}
                </tr>
              ))}
              {!loading && rows.map((r) => (
                <tr key={r[rowKey]} className={`border-t border-line hover:bg-hover/50 ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName?.(r) || ''}`} onClick={() => onRowClick?.(r)}>
                  {selectable && <td className="td" onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.includes(r[rowKey])} onChange={() => toggle(r[rowKey])} aria-label="选择行" /></td>}
                  {columns.map((c) => (
                    <td key={c.key} className={`td ${c.sticky === 'right' ? 'sticky right-0 bg-card' : ''}`} style={{ textAlign: c.align || 'left' }}>
                      {c.render ? c.render(r) : (r[c.key] ?? '-')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && <EmptyState title={empty?.title} description={empty?.description} />}
        </div>
      )}
      {!error && total > 0 && onPageChange && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />}
    </section>
  );
}
