/** 管理设置入口：5 个功能全部平铺展示（大尺寸卡片，含图标与说明），不滚动、不折叠。 */
export default function SettingsNav({ items, value, onChange }) {
  return (
    <nav role="tablist" aria-label="管理设置" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
      {items.map((t) => {
        const on = t.key === value;
        const Icon = t.icon;
        return (
          <button
            key={t.key} type="button" role="tab" id={`settings-tab-${t.key}`} aria-selected={on} aria-controls="settings-panel"
            onClick={() => onChange(t.key)}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors ${on ? 'bg-primary text-primary-text border-primary shadow-sm' : 'bg-card border-line text-fg hover:bg-hover'}`}
          >
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${on ? 'bg-card/20' : 'bg-muted text-fg-muted'}`}><Icon size={20} /></span>
            <span className="min-w-0">
              <span className="block text-base font-semibold leading-tight">{t.label}</span>
              <span className={`block text-xs mt-0.5 truncate ${on ? 'opacity-80' : 'text-fg-subtle'}`}>{t.desc}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
