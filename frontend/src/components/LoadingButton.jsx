import { Loader2 } from 'lucide-react';

/** 带加载态的按钮：loading 时禁用并显示转圈。 */
export default function LoadingButton({ loading, disabled, children, className = 'btn-primary', icon: Icon, ...rest }) {
  return (
    <button type="button" className={className} disabled={loading || disabled} {...rest}>
      {loading ? <Loader2 size={15} className="spin" /> : Icon ? <Icon size={15} /> : null}
      {children}
    </button>
  );
}
