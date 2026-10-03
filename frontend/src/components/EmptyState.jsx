import { Inbox } from 'lucide-react';

/** 空态：区分「未筛选无数据 / 筛选无结果」，由调用方传不同 title/description。 */
export default function EmptyState({ icon: Icon = Inbox, title = '暂无数据', description, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-4 fade-in">
      <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-3"><Icon size={26} className="text-fg-subtle" /></div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="text-xs text-fg-muted mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
