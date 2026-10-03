import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export const MASK = '******';

/**
 * 密钥输入（铁律12）：已保存的值显示 ******，不回显明文；
 * 聚焦时若仍是占位符则清空以便重新输入，失焦且未输入时恢复占位符（表示“不修改”）。
 */
export default function SecretInput({ value, onChange, saved, placeholder = '请输入', id, invalid, 'aria-label': ariaLabel }) {
  const [show, setShow] = useState(false);
  const isMask = value === MASK;
  return (
    <div className="relative">
      <input
        id={id} aria-label={ariaLabel} autoComplete="new-password"
        className={`field pr-9 font-mono ${invalid ? 'field-error' : ''}`}
        type={show && !isMask ? 'text' : 'password'}
        value={value} placeholder={saved ? '已保存，留空表示不修改' : placeholder}
        onFocus={() => { if (isMask) onChange(''); }}
        onBlur={() => { if (saved && value === '') onChange(MASK); }}
        onChange={(e) => onChange(e.target.value)}
      />
      {!isMask && value && (
        <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg" aria-label={show ? '隐藏' : '显示'} onClick={() => setShow(!show)}>
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      )}
    </div>
  );
}
