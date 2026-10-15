/** 金额输入：文本框 + 小数键盘，值以字符串保存，避免输入中途被格式化打断。 */
export default function NumInput({ value, onChange, invalid, 'aria-label': ariaLabel, disabled, className = '' }) {
  return (
    <input
      className={`field text-right tabular-nums ${invalid ? 'field-error' : ''} ${className}`} inputMode="decimal" aria-label={ariaLabel}
      disabled={disabled} value={value} onChange={(e) => { const v = e.target.value; if (/^\d*\.?\d{0,2}$/.test(v)) onChange(v); }}
    />
  );
}
