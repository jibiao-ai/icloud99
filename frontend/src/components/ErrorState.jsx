import { AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

/** 错误态：notConfigured（40002）时引导去设置页，否则提供重试。 */
export default function ErrorState({ error, onRetry, settingsTab }) {
  const msg = error?.message || '加载失败';
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-4" role="alert">
      <div className="w-14 h-14 rounded-2xl bg-danger-soft flex items-center justify-center mb-3"><AlertCircle size={26} className="text-danger" /></div>
      <p className="text-sm font-medium text-fg">{error?.notConfigured ? '尚未完成配置' : '加载失败'}</p>
      <p className="text-xs text-fg-muted mt-1 max-w-md break-words">{msg}</p>
      <div className="mt-4 flex gap-2">
        {error?.notConfigured && settingsTab && <Link className="btn-primary" to={`/settings?tab=${settingsTab}`}>去配置</Link>}
        {onRetry && <button className="btn-default" onClick={onRetry}>重试</button>}
      </div>
    </div>
  );
}
