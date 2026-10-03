/** 页签。items[{key,label,count,icon}]；面板 id=`${idPrefix}-panel` 关联。 */
export default function Tabs({ items, value, onChange, idPrefix = 'tabs' }) {
  return (
    <div role="tablist" className="flex items-center gap-1.5 overflow-x-auto scroll-thin pb-1 mb-4">
      {items.map((t) => {
        const on = t.key === value;
        const Icon = t.icon;
        return (
          <button
            key={t.key} type="button" role="tab" id={`${idPrefix}-tab-${t.key}`} aria-selected={on} aria-controls={`${idPrefix}-panel`}
            onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm transition-colors ${on ? 'bg-primary text-primary-text font-semibold' : 'bg-card border border-line text-fg-muted hover:bg-hover'}`}
          >
            {Icon && <Icon size={15} />}
            {t.label}
            {t.count !== undefined && <span className={`text-[11px] px-1.5 rounded ${on ? 'bg-card/20' : 'bg-muted'}`}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
