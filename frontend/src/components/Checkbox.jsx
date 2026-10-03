import { Check } from 'lucide-react';

/** 自绘复选框（替代原生 checkbox）。 */
export default function Checkbox({ checked, onChange, label, disabled, 'aria-label': ariaLabel }) {
  return (
    <label className={`inline-flex items-center gap-2 select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <button
        type="button" role="checkbox" aria-checked={!!checked} aria-label={ariaLabel || label} disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${checked ? 'bg-primary border-primary text-primary-text' : 'bg-card border-line hover:border-fg-subtle'}`}
      >
        {checked && <Check size={12} strokeWidth={3} />}
      </button>
      {label && <span className="text-sm text-fg" onClick={() => !disabled && onChange?.(!checked)}>{label}</span>}
    </label>
  );
}
