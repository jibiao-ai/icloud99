/** 自绘单选（替代原生 radio）。 */
export default function Radio({ checked, onChange, label, disabled }) {
  return (
    <label className={`inline-flex items-center gap-2 select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <button
        type="button" role="radio" aria-checked={!!checked} aria-label={label} disabled={disabled}
        onClick={() => onChange?.()}
        className={`h-4 w-4 rounded-full border flex items-center justify-center transition-colors ${checked ? 'border-primary' : 'border-line hover:border-fg-subtle'}`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-primary" />}
      </button>
      {label && <span className="text-sm text-fg" onClick={() => !disabled && onChange?.()}>{label}</span>}
    </label>
  );
}
