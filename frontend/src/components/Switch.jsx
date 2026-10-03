/** 开关。 */
export default function Switch({ checked, onChange, disabled, 'aria-label': ariaLabel }) {
  return (
    <button
      type="button" role="switch" aria-checked={!!checked} aria-label={ariaLabel} disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-primary' : 'bg-hover'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-card shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  );
}
