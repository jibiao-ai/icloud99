import CustomSelect from './CustomSelect';

/** 筛选栏容器。上游筛选变化时由调用方清空下游。 */
export function FilterBar({ children }) {
  return <div className="card px-4 py-3 mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">{children}</div>;
}

/** 带标签的下拉筛选项。 */
export function Filter({ label, options, value, onChange, width = 160, ...rest }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-fg-muted whitespace-nowrap">{label}</span>
      <CustomSelect size="sm" options={options} value={value} onChange={onChange} width={width} aria-label={label} {...rest} />
    </div>
  );
}
